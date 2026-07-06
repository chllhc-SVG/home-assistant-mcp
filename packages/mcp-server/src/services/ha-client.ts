import { extractEntityCapabilitySnapshot } from './device-capabilities.js';

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

  async discoverEntities(domains = ['light', 'switch', 'button', 'number', 'climate', 'sensor']) {
    const states = await this.listStates();
    return states
      .filter((item) => typeof item.entity_id === 'string' && domains.some((domain) => (item.entity_id as string).startsWith(`${domain}.`)))
      .map((item) => {
        const snapshot = extractEntityCapabilitySnapshot(item);
        if (!snapshot) {
          return {
            entity_id: item.entity_id as string,
            domain: (item.entity_id as string).split('.')[0],
            state: 'unknown',
            friendly_name: item.entity_id as string,
            supports_brightness: false,
            supports_value: false,
            supports_temperature: false,
            supports_hvac_mode: false,
            supports_fan_mode: false,
            supports_swing_mode: false,
            supported_color_modes: [],
            hvac_modes: [],
            fan_modes: [],
            swing_modes: [],
            raw: item,
          };
        }
        return snapshot;
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

  async turnOnLight(entityId: string, brightness?: number, colorTempKelvin?: number) {
    if (colorTempKelvin === undefined) {
      return this.request('/api/services/light/turn_on', {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...(brightness === undefined ? {} : { brightness }) }),
      });
    }

    return this.setLightColorTemp(entityId, colorTempKelvin, brightness);
  }

  async setLightColorTemp(entityId: string, colorTempKelvin: number, brightness?: number) {
    const basePayload = { entity_id: entityId, ...(brightness === undefined ? {} : { brightness }) };
    const candidates = [
      { ...basePayload, color_temp_kelvin: colorTempKelvin },
      { ...basePayload, kelvin: colorTempKelvin },
      { ...basePayload, color_temp: Math.round(1000000 / colorTempKelvin) },
    ];

    let lastError: unknown;
    for (const payload of candidates) {
      try {
        return await this.request('/api/services/light/turn_on', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } catch (error) {
        lastError = error;
        if (!(error instanceof HomeAssistantError) || error.code !== 'SERVICE_FAILED' || error.status !== 400) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  turnOffLight(entityId: string) {
    return this.request('/api/services/light/turn_off', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  toggleLight(entityId: string) {
    return this.request('/api/services/light/toggle', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  pressButton(entityId: string) {
    return this.request('/api/services/button/press', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
  }

  setNumberValue(entityId: string, value: number) {
    return this.request('/api/services/number/set_value', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, value }),
    });
  }

  setClimateTemperature(entityId: string, temperature: number) {
    return this.request('/api/services/climate/set_temperature', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, temperature }),
    });
  }

  setClimateHvacMode(entityId: string, hvacMode: string) {
    return this.request('/api/services/climate/set_hvac_mode', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, hvac_mode: hvacMode }),
    });
  }

  setClimateFanMode(entityId: string, fanMode: string) {
    return this.request('/api/services/climate/set_fan_mode', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, fan_mode: fanMode }),
    });
  }

  setClimateSwingMode(entityId: string, swingMode: string) {
    return this.request('/api/services/climate/set_swing_mode', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, swing_mode: swingMode }),
    });
  }
}
