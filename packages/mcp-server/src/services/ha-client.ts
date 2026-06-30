export class HomeAssistantError extends Error {
  constructor(
    public readonly code: 'AUTH_FAILED' | 'TIMEOUT' | 'SERVICE_FAILED',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'HomeAssistantError';
  }
}

export class HaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 15000,
  ) {}

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    if (!this.token) {
      throw new HomeAssistantError('AUTH_FAILED', 'Home Assistant token is empty. 请设置 HOME_ASSISTANT_TOKEN 或 HA_TOKEN。');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });

      if (response.status === 401 || response.status === 403) {
        throw new HomeAssistantError('AUTH_FAILED', `Home Assistant authentication failed: ${response.status}`, response.status);
      }

      if (response.status === 408 || response.status === 504) {
        throw new HomeAssistantError('TIMEOUT', `Home Assistant service timed out: ${response.status}. 请求已到达 Home Assistant，但设备或集成响应超时。`, response.status);
      }

      if (!response.ok) {
        throw new HomeAssistantError('SERVICE_FAILED', `Home Assistant API error: ${response.status}`, response.status);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof HomeAssistantError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HomeAssistantError('TIMEOUT', `Home Assistant request timed out after ${this.timeoutMs}ms`);
      }
      throw new HomeAssistantError('SERVICE_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  getState(entityId: string) {
    return this.request<Record<string, unknown>>(`/api/states/${entityId}`, { method: 'GET' });
  }

  listStates() {
    return this.request<Array<Record<string, unknown>>>('/api/states', { method: 'GET' });
  }

  async discoverEntities(domains = ['light', 'switch']) {
    const states = await this.listStates();
    return states
      .filter((item) => typeof item.entity_id === 'string' && domains.some((domain) => (item.entity_id as string).startsWith(`${domain}.`)))
      .map((item) => {
        const attributes = typeof item.attributes === 'object' && item.attributes !== null ? (item.attributes as Record<string, unknown>) : {};
        const entityId = item.entity_id as string;
        return {
          entity_id: entityId,
          domain: entityId.split('.')[0],
          state: typeof item.state === 'string' ? item.state : 'unknown',
          friendly_name: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : entityId,
          supports_brightness: Object.prototype.hasOwnProperty.call(attributes, 'brightness'),
          raw: item,
        };
      });
  }

  discoverLights() {
    return this.discoverEntities(['light']);
  }

  turnOn(entityId: string) {
    const domain = entityId.split('.')[0];
    return this.request(`/api/services/${domain}/turn_on`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  turnOff(entityId: string) {
    const domain = entityId.split('.')[0];
    return this.request(`/api/services/${domain}/turn_off`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  turnOnLight(entityId: string, brightness?: number) {
    return this.request('/api/services/light/turn_on', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, ...(brightness === undefined ? {} : { brightness }) }),
    });
  }

  turnOffLight(entityId: string) {
    return this.request('/api/services/light/turn_off', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }
}
