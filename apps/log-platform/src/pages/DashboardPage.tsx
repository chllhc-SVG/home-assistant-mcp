import React from 'react';
import { Alert, Badge, Button, Card, Checkbox, Col, Descriptions, Drawer, Empty, Form, Input, Menu, Row, Select, Slider, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { ApiOutlined, AppstoreOutlined, BulbOutlined, CheckCircleOutlined, CompassOutlined, FilterOutlined, FireOutlined, PoweroffOutlined, ReloadOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { api, type DeviceExposureConfig, type DeviceRecord, type DiscoveredEntity, type LogRecord } from '../api/client';

const formatBeijingTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replaceAll('/', '-');
};

const formatDeviceLabel = (device: DeviceRecord) => `${device.display_name} · ${device.entity_id.split('.')[1] ?? device.entity_id}`;

const fallbackDevices: DeviceRecord[] = [];

const fallbackLogs: LogRecord[] = [
  {
    id: '1',
    request_id: 'req_1',
    timestamp: '2026-06-30T10:18:21Z',
    user_input: '打开客厅灯',
    intent: 'turn_on',
    tool_name: 'turn_on_light',
    resolved_device: { display_name: '客厅灯', entity_id: 'light.living_room_main' },
    result_status: 'success',
    duration_ms: 180,
  },
];

export const DashboardPage = () => {
  const [form] = Form.useForm();
  const [logs, setLogs] = React.useState<LogRecord[]>(fallbackLogs);
  const [devices, setDevices] = React.useState<DeviceRecord[]>(fallbackDevices);
  const [discoveredEntities, setDiscoveredEntities] = React.useState<DiscoveredEntity[]>([]);
  const [selectedDevice, setSelectedDevice] = React.useState<DeviceRecord | null>(null);
  const [selectedLog, setSelectedLog] = React.useState<LogRecord | null>(null);
  const [brightness, setBrightness] = React.useState(180);
  const [colorTempKelvin, setColorTempKelvin] = React.useState(4000);
  const [targetTemperature, setTargetTemperature] = React.useState(23);
  const [numberValue, setNumberValue] = React.useState(0);
  const [hvacMode, setHvacMode] = React.useState<string>('auto');
  const [fanMode, setFanMode] = React.useState<string>();
  const [swingMode, setSwingMode] = React.useState<string>();
  const [overview, setOverview] = React.useState({ total: 0, success: 0, failure: 0, successRate: 0 });
  const [failureStats, setFailureStats] = React.useState<{ total: number; byErrorCode: Record<string, number>; byTool: Record<string, number> }>({ total: 0, byErrorCode: {}, byTool: {} });
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [controlLoading, setControlLoading] = React.useState(false);
  const [discoverLoading, setDiscoverLoading] = React.useState(false);
  const [deviceDomainFilter, setDeviceDomainFilter] = React.useState<string>('all');
  const [whitelistDomainFilter, setWhitelistDomainFilter] = React.useState<string>('all');
  const [whitelistAreaFilter, setWhitelistAreaFilter] = React.useState<string>('all');
  const [whitelistKeyword, setWhitelistKeyword] = React.useState('');
  const [exposureLoading, setExposureLoading] = React.useState(false);
  const [exposedDevices, setExposedDevices] = React.useState<string[]>([]);
  const [expandedDeviceNames, setExpandedDeviceNames] = React.useState<string[]>([]);
  const [deviceEntitySelection, setDeviceEntitySelection] = React.useState<Record<string, string | undefined>>({});
  const [deviceExposureRecords, setDeviceExposureRecords] = React.useState<DeviceRecord[]>([]);
  const [selectedLogIds, setSelectedLogIds] = React.useState<React.Key[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = React.useState<React.Key[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const deviceSectionRef = React.useRef<HTMLDivElement>(null);
  const logsSectionRef = React.useRef<HTMLDivElement>(null);
  const statusSectionRef = React.useRef<HTMLDivElement>(null);

  const loadData = React.useCallback(async (query?: URLSearchParams) => {
    setLoading(true);
    try {
      const [overviewResult, failureResult, logsResult, devicesResult, exposureResult] = await Promise.allSettled([
        api.getOverview(),
        api.getFailureStats(),
        api.listLogs(query),
        api.listDevices(),
        api.getDeviceExposure(),
      ]);

      if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
      if (failureResult.status === 'fulfilled') setFailureStats(failureResult.value);
      setLogs(logsResult.status === 'fulfilled' && logsResult.value.items.length > 0 ? logsResult.value.items : fallbackLogs);

      const nextDevices = devicesResult.status === 'fulfilled' ? devicesResult.value.devices : [];
      const normalizedDevices = nextDevices.length > 0 ? nextDevices : fallbackDevices;
      setDevices(normalizedDevices);
      setSelectedDevice((current) => current ? normalizedDevices.find((device) => device.entity_id === current.entity_id) ?? null : normalizedDevices[0] ?? null);
      if (exposureResult.status === 'fulfilled') {
        setExposedDevices(exposureResult.value.exposure);
        setDeviceExposureRecords(exposureResult.value.records as DeviceRecord[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
    void discoverEntities();
  }, [loadData]);

  React.useEffect(() => {
    if (typeof selectedDevice?.brightness === 'number') setBrightness(selectedDevice.brightness);
    if (typeof selectedDevice?.target_temperature === 'number') setTargetTemperature(selectedDevice.target_temperature);
    if (selectedDevice?.color_mode === 'color_temp' && typeof selectedDevice?.target_temperature === 'number') setColorTempKelvin(Math.round(selectedDevice.target_temperature));
    if (selectedDevice?.hvac_mode) setHvacMode(selectedDevice.hvac_mode);
    if (selectedDevice?.fan_mode) setFanMode(selectedDevice.fan_mode);
    if (selectedDevice?.swing_mode) setSwingMode(selectedDevice.swing_mode);
    if (typeof selectedDevice?.sensor_value === 'number') setNumberValue(selectedDevice.sensor_value);
  }, [selectedDevice?.entity_id, selectedDevice?.brightness, selectedDevice?.target_temperature, selectedDevice?.hvac_mode, selectedDevice?.fan_mode, selectedDevice?.swing_mode, selectedDevice?.sensor_value]);

  const refreshLogs = async () => loadData();
  const refreshSelectedDeviceState = async (device: DeviceRecord) => {
    try {
      const state = device.domain === 'sensor' ? await api.getSensorState(device.entity_id) : device.domain === 'climate' ? await api.getClimateState(device.entity_id) : device.domain === 'switch' ? await api.getSwitchState(device.entity_id) : device.domain === 'button' ? await api.getButtonState(device.entity_id) : device.domain === 'number' ? await api.getNumberState(device.entity_id) : await api.getLightState(device.entity_id);
      setSelectedDevice((current) => current ? { ...current, state: String(state.state ?? current.state ?? 'unknown') } : current);
    } catch {
      // ignore
    }
  };

  const discoverEntities = async () => {
    setDiscoverLoading(true);
    try {
      console.log('[dashboard] discoverEntities click');
      const result = await api.discoverEntities();
      console.log('[dashboard] discoverEntities result count', result.entities.length);
      console.log('[dashboard] discoverEntities registry stats', {
        total: result.entities.length,
        withDeviceId: result.entities.filter((entity) => entity.device_id).length,
        withDeviceName: result.entities.filter((entity) => entity.device_name).length,
        withAreaId: result.entities.filter((entity) => entity.area_id).length,
        withAreaName: result.entities.filter((entity) => entity.area_name).length,
      });
      console.table(result.entities.slice(0, 10).map((entity) => ({
        entity_id: entity.entity_id,
        friendly_name: entity.friendly_name,
        device_id: entity.device_id ?? '',
        device_name: entity.device_name ?? '',
        area_id: entity.area_id ?? '',
        area_name: entity.area_name ?? '',
        platform: entity.platform ?? '',
        domain: entity.domain ?? '',
      })));
      console.table(result.entities.filter((entity) => entity.device_id || entity.area_id).slice(0, 10).map((entity) => ({
        entity_id: entity.entity_id,
        friendly_name: entity.friendly_name,
        device_id: entity.device_id ?? '',
        device_name: entity.device_name ?? '',
        area_id: entity.area_id ?? '',
        area_name: entity.area_name ?? '',
        platform: entity.platform ?? '',
        domain: entity.domain ?? '',
      })));
      setDiscoveredEntities(result.entities);
      messageApi.success(`已发现 ${result.entities.length} 个 Home Assistant 设备实体`);
    } catch (error) {
      console.error('[dashboard] discoverEntities error', error);
      messageApi.error(error instanceof Error ? error.message : '发现设备实体失败');
    } finally {
      setDiscoverLoading(false);
    }
  };

  const control = async (action: 'on' | 'off' | 'brightness' | 'color_temp' | 'press' | 'value' | 'temperature' | 'hvac_mode' | 'fan_mode' | 'swing_mode') => {
    if (!selectedDevice) return;
    setControlLoading(true);
    try {
      if (action === 'on' && (selectedDevice.domain === 'light' || selectedDevice.domain === 'switch')) await api.turnOnSwitch(selectedDevice.entity_id);
      if (action === 'off' && (selectedDevice.domain === 'light' || selectedDevice.domain === 'switch')) await api.turnOffSwitch(selectedDevice.entity_id);
      if (action === 'brightness') await api.setLightBrightness(selectedDevice.entity_id, brightness);
      if (action === 'color_temp') await api.setLightState(selectedDevice.entity_id, 'on', undefined, colorTempKelvin);
      if (action === 'press') await api.pressButton(selectedDevice.entity_id);
      if (action === 'value') await api.setNumberValue(selectedDevice.entity_id, numberValue);
      if (action === 'temperature' && selectedDevice.domain === 'climate') await api.setClimateTemperature(selectedDevice.entity_id, targetTemperature);
      if (action === 'hvac_mode') await api.setClimateHvacMode(selectedDevice.entity_id, hvacMode);
      if (action === 'fan_mode' && fanMode) await api.setClimateFanMode(selectedDevice.entity_id, fanMode);
      if (action === 'swing_mode' && swingMode) await api.setClimateSwingMode(selectedDevice.entity_id, swingMode);
      await refreshSelectedDeviceState(selectedDevice);
      messageApi.success('控制指令已执行，日志已刷新');
      void refreshLogs();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '控制失败');
    } finally {
      setControlLoading(false);
    }
  };

  const queryState = async () => {
    if (!selectedDevice) return;
    setControlLoading(true);
    try {
      const state = selectedDevice.domain === 'sensor' ? await api.getSensorState(selectedDevice.entity_id) : selectedDevice.domain === 'climate' ? await api.getClimateState(selectedDevice.entity_id) : selectedDevice.domain === 'switch' ? await api.getSwitchState(selectedDevice.entity_id) : selectedDevice.domain === 'button' ? await api.getButtonState(selectedDevice.entity_id) : selectedDevice.domain === 'number' ? await api.getNumberState(selectedDevice.entity_id) : await api.getLightState(selectedDevice.entity_id);
      messageApi.info(`当前状态：${String(state.state ?? 'unknown')}`);
      void refreshLogs();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '查询失败');
    } finally {
      setControlLoading(false);
    }
  };

  const onSearch = async () => {
    const values = form.getFieldsValue();
    const params = new URLSearchParams();
    if (values.keyword) params.set('keyword', values.keyword);
    if (values.tool_name) params.set('tool_name', values.tool_name);
    if (values.status) params.set('status', values.status);
    if (values.device_name) params.set('device_name', values.device_name);
    await loadData(params);
  };

  const resetFilters = () => { form.resetFields(); void loadData(); };
  const filterValues = Form.useWatch([], form) ?? {};
  const logKeywordCount = [filterValues.keyword, filterValues.tool_name, filterValues.device_name, filterValues.status].filter(Boolean).length;

  const scrollTo = (ref: React.RefObject<HTMLDivElement>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const combinedDevices = React.useMemo(() => {
    const discoveredByEntityId = new Map(discoveredEntities.map((entity) => [entity.entity_id, entity]));
    const merged = devices.map((device) => {
      const discovered = discoveredByEntityId.get(device.entity_id);
      return {
        ...device,
        exposed: exposedDevices.includes(device.entity_id),
        device_name: discovered?.device_name ?? device.device_name,
        area_name: discovered?.area_name ?? device.area_name,
        area_id: discovered?.area_id ?? device.area_id,
      } as DeviceRecord;
    });

    for (const entity of discoveredEntities) {
      if (!merged.some((device) => device.entity_id === entity.entity_id)) {
        merged.push({
          device_id: entity.device_id ?? entity.entity_id,
          display_name: entity.device_name ?? entity.friendly_name,
          entity_id: entity.entity_id,
          room: entity.area_name ?? entity.domain ?? 'unknown',
          domain: entity.domain as DeviceRecord['domain'],
          type: entity.domain as DeviceRecord['type'],
          enabled: true,
          exposed: exposedDevices.includes(entity.entity_id),
          friendly_name: entity.friendly_name,
          device_name: entity.device_name,
          area_id: entity.area_id,
          area_name: entity.area_name,
        });
      }
    }

    return merged;
  }, [devices, discoveredEntities, exposedDevices]);
  const whitelistDevices = combinedDevices.filter((device) => Boolean(device.device_name));
  const filteredWhitelistDevices = whitelistDevices.filter((device) => {
    if (whitelistDomainFilter !== 'all' && device.domain !== whitelistDomainFilter) return false;
    if (whitelistAreaFilter !== 'all' && (device.area_name ?? 'unassigned') !== whitelistAreaFilter) return false;
    const keyword = whitelistKeyword.trim();
    if (
      keyword &&
      ![
        device.display_name,
        device.friendly_name,
        device.entity_id,
        device.room ?? '',
        device.device_name ?? '',
        device.area_name ?? '',
      ].some((value) => value?.includes(keyword))
    ) return false;
    return true;
  });
  const whitelistDeviceRows = Array.from(new Map(filteredWhitelistDevices.map((device) => [device.device_name as string, device])).values());
  const filteredDevices = deviceDomainFilter === 'all' ? devices : devices.filter((device) => device.domain === deviceDomainFilter);
  const databaseWhitelistEntityIds = React.useMemo(() => new Set(deviceExposureRecords.filter((device) => device.enabled !== false).map((device) => device.entity_id)), [deviceExposureRecords]);
  const databaseWhitelistCount = databaseWhitelistEntityIds.size;
  const discoveredEntityCount = discoveredEntities.length;
  const unexposedEntityCount = Math.max(discoveredEntityCount - discoveredEntities.filter((entity) => databaseWhitelistEntityIds.has(entity.entity_id)).length, 0);
  const selectedRooms = Array.from(new Set(whitelistDevices.filter((device) => exposedDevices.includes(device.entity_id)).map((device) => device.room).filter(Boolean))) as string[];
  const allAreas = Array.from(new Set(whitelistDevices.map((device) => device.area_name).filter(Boolean))) as string[];
  const deviceTypeOptions = [
    { value: 'all', label: '全部设备' },
    { value: 'switch', label: '开关' },
    { value: 'light', label: '灯光' },
    { value: 'button', label: '按钮' },
    { value: 'number', label: '数值' },
    { value: 'climate', label: '空调' },
    { value: 'sensor', label: '传感器' },
  ];

  const saveExposure = async () => {
    setExposureLoading(true);
    try {
      const selectedEntityIds = Array.from(new Set([...exposedDevices, ...Object.values(deviceEntitySelection).filter((value): value is string => Boolean(value))]));
      const payload: DeviceExposureConfig = {
        rooms: [],
        devices: selectedEntityIds,
      };
      const result = await api.saveDeviceExposure(payload);
      setExposedDevices(result.devices);
      messageApi.success(`白名单已保存，当前选择 ${result.devices.length} 个实体`);
      await loadData();
      void discoverEntities();
      setSelectedDevice((current) => current ? combinedDevices.find((device) => device.entity_id === current.entity_id) ?? current : current);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setExposureLoading(false);
    }
  };

  const toggleExposure = (entityId: string, checked: boolean) => {
    setExposedDevices((current) => checked ? Array.from(new Set([...current, entityId])) : current.filter((id) => id !== entityId));
    setDeviceEntitySelection((current) => ({
      ...current,
      [entityId]: checked ? entityId : undefined,
    }));
  };

  const toggleDeviceExposure = (deviceName: string, checked: boolean) => {
    const deviceEntities = combinedDevices.filter((device) => device.device_name === deviceName).map((device) => device.entity_id);
    setExposedDevices((current) => checked ? Array.from(new Set([...current, ...deviceEntities])) : current.filter((id) => !deviceEntities.includes(id)));
    setDeviceEntitySelection((current) => {
      const next = { ...current };
      for (const entityId of deviceEntities) {
        if (checked) next[entityId] = entityId;
        else delete next[entityId];
      }
      return next;
    });
  };

  const deleteControlDevice = async (entityId: string) => {
    await deleteControlDevices([entityId]);
  };

  const deleteControlDevices = async (entityIds: string[]) => {
    const ids = Array.from(new Set(entityIds.filter(Boolean)));
    if (ids.length === 0) return;
    const previousDevices = devices;
    const previousExposedDevices = exposedDevices;
    const previousExposureRecords = deviceExposureRecords;
    const previousSelectedDeviceIds = selectedDeviceIds;

    setDevices((current) => current.filter((device) => !ids.includes(device.entity_id)));
    setExposedDevices((current) => current.filter((id) => !ids.includes(id)));
    setDeviceExposureRecords((current) => current.filter((device) => !ids.includes(device.entity_id)));
    setSelectedDeviceIds((current) => current.filter((id) => !ids.includes(String(id))));
    setDeviceEntitySelection((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });
    setSelectedDevice((current) => current && ids.includes(current.entity_id) ? null : current);
    try {
      const result = await api.saveDeviceExposure({ rooms: [], devices: ids, action: 'delete' });
      setExposedDevices(result.devices);
      setDeviceExposureRecords((current) => current.filter((device) => result.devices.includes(device.entity_id)));
      messageApi.success(ids.length === 1 ? '设备已从白名单删除' : `已删除 ${ids.length} 个白名单设备`);
      void api.getDeviceExposure().then((response) => {
        setExposedDevices(response.exposure);
        setDeviceExposureRecords(response.records as DeviceRecord[]);
      }).catch(() => undefined);
    } catch (error) {
      setDevices(previousDevices);
      setExposedDevices(previousExposedDevices);
      setDeviceExposureRecords(previousExposureRecords);
      setSelectedDeviceIds(previousSelectedDeviceIds);
      messageApi.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  const renderControlPanel = () => {
    if (!selectedDevice) return <Empty description="请选择一个设备开始控制" />;
    const domain = selectedDevice.domain;
    const isCeilingLightSwitch = selectedDevice.entity_id === 'switch.xiaomi_w2_2de4_left_switch_service';
    const supportsLightBrightness = domain === 'light' && selectedDevice.supports_brightness;
    const supportsColorTemp = domain === 'light';
    const supportsTemperature = domain === 'climate' && selectedDevice.supports_temperature;
    const supportsHvacMode = domain === 'climate' && selectedDevice.supports_hvac_mode && (selectedDevice.hvac_modes?.length ?? 0) > 0;
    const supportsFanMode = domain === 'climate' && selectedDevice.supports_fan_mode && (selectedDevice.fan_modes?.length ?? 0) > 0;
    const supportsSwingMode = domain === 'climate' && selectedDevice.supports_swing_mode && (selectedDevice.swing_modes?.length ?? 0) > 0;

    return <div className="control-panel"><Space direction="vertical" size={16} style={{ width: '100%' }}><div className="status-badge"><Badge status={selectedDevice.enabled === false ? 'error' : 'success'} /><Typography.Text strong>{selectedDevice.display_name}</Typography.Text><Tag>{selectedDevice.domain ?? '-'}</Tag></div><Space wrap>{(domain === 'switch' || isCeilingLightSwitch) ? <><Button type="primary" icon={<BulbOutlined />} loading={controlLoading} onClick={() => void control('on')}>打开</Button><Button danger icon={<PoweroffOutlined />} loading={controlLoading} onClick={() => void control('off')}>关闭</Button></> : null}{domain === 'button' ? <Button type="primary" icon={<AppstoreOutlined />} loading={controlLoading} onClick={() => void control('press')}>按下</Button> : null}<Button icon={<CheckCircleOutlined />} loading={controlLoading} onClick={() => void queryState()}>查询状态</Button></Space>{supportsLightBrightness ? <Card size="small" bordered={false} style={{ borderRadius: 16 }} title={<span className="module-title"><FireOutlined />亮度控制</span>}><Space direction="vertical" style={{ width: '100%' }}><Typography.Text strong>亮度：{brightness}</Typography.Text><Slider min={0} max={255} value={brightness} onChange={setBrightness} /><Button loading={controlLoading} onClick={() => void control('brightness')}>设置亮度</Button></Space></Card> : null}{supportsColorTemp ? <Card size="small" bordered={false} style={{ borderRadius: 16 }} title={<span className="module-title"><CompassOutlined />色温控制</span>}><Space direction="vertical" style={{ width: '100%' }}><Typography.Text strong>色温：{colorTempKelvin}K</Typography.Text><Slider min={selectedDevice.color_temp_min_kelvin ?? 3000} max={selectedDevice.color_temp_max_kelvin ?? 6400} step={100} value={colorTempKelvin} onChange={setColorTempKelvin} /><Button loading={controlLoading} onClick={() => void control('color_temp')}>设置色温</Button></Space></Card> : null}{domain === 'number' && selectedDevice.supports_value ? <Card size="small" bordered={false} style={{ borderRadius: 16 }} title={<span className="module-title"><AppstoreOutlined />数值控制</span>}><Space direction="vertical" style={{ width: '100%' }}><Typography.Text strong>数值：{numberValue}</Typography.Text><Slider min={selectedDevice.value_min ?? 0} max={selectedDevice.value_max ?? 100} step={selectedDevice.value_step ?? 1} value={numberValue} onChange={setNumberValue} /><Button loading={controlLoading} onClick={() => void control('value')}>设置数值</Button></Space></Card> : null}{domain === 'climate' ? <Card size="small" bordered={false} style={{ borderRadius: 16 }} title={<span className="module-title"><CompassOutlined />空调控制</span>}><Space direction="vertical" size={12} style={{ width: '100%' }}>{supportsTemperature ? <div><Typography.Text strong>目标温度：{targetTemperature}{selectedDevice.temperature_unit ?? '°C'}</Typography.Text><Slider min={selectedDevice.temperature_min ?? 16} max={selectedDevice.temperature_max ?? 30} step={selectedDevice.temperature_step ?? 1} value={targetTemperature} onChange={setTargetTemperature} /><Button loading={controlLoading} onClick={() => void control('temperature')}>设置温度</Button></div> : null}{supportsHvacMode ? <Space><Select style={{ width: 180 }} value={hvacMode} options={(selectedDevice.hvac_modes ?? []).map((mode) => ({ value: mode, label: mode }))} onChange={setHvacMode} /><Button loading={controlLoading} onClick={() => void control('hvac_mode')}>设置模式</Button></Space> : null}{supportsFanMode ? <Space><Select style={{ width: 180 }} value={fanMode} options={(selectedDevice.fan_modes ?? []).map((mode) => ({ value: mode, label: mode }))} onChange={setFanMode} /><Button loading={controlLoading} onClick={() => void control('fan_mode')}>设置风扇</Button></Space> : null}{supportsSwingMode ? <Space><Select style={{ width: 180 }} value={swingMode} options={(selectedDevice.swing_modes ?? []).map((mode) => ({ value: mode, label: mode }))} onChange={setSwingMode} /><Button loading={controlLoading} onClick={() => void control('swing_mode')}>设置摆风</Button></Space> : null}</Space></Card> : null}{domain === 'sensor' ? <Card size="small" bordered={false} style={{ borderRadius: 16 }} title={<span className="module-title"><CompassOutlined />传感器状态</span>}><Typography.Text>当前值：{selectedDevice.sensor_value ?? selectedDevice.state ?? '-'}{selectedDevice.sensor_unit ?? ''}</Typography.Text></Card> : null}</Space></div>;
  };

  const deleteLog = async (id: string) => {
    const previousLogs = logs;
    setLogs((current) => current.filter((log) => log.id !== id && log.request_id !== id));
    setSelectedLogIds((current) => current.filter((key) => key !== id));
    try {
      await api.deleteLog(id);
      messageApi.success('日志已删除');
      void Promise.allSettled([api.getOverview(), api.getFailureStats()]).then(([overviewResult, failureResult]) => {
        if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
        if (failureResult.status === 'fulfilled') setFailureStats(failureResult.value);
      });
    } catch (error) {
      setLogs(previousLogs);
      messageApi.error(error instanceof Error ? error.message : '删除日志失败');
    }
  };

  const deleteSelectedLogs = async () => {
    const ids = selectedLogIds.map(String);
    if (ids.length === 0) return;
    const previousLogs = logs;
    setLogs((current) => current.filter((log) => !ids.includes(log.id) && !ids.includes(log.request_id)));
    setSelectedLogIds([]);
    try {
      const result = await api.deleteLogs(ids);
      messageApi.success(`已删除 ${result.deleted} 条日志`);
      void Promise.allSettled([api.getOverview(), api.getFailureStats()]).then(([overviewResult, failureResult]) => {
        if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value);
        if (failureResult.status === 'fulfilled') setFailureStats(failureResult.value);
      });
    } catch (error) {
      setLogs(previousLogs);
      setSelectedLogIds(ids);
      messageApi.error(error instanceof Error ? error.message : '批量删除日志失败');
    }
  };

  const logColumns = [
    { title: '时间', dataIndex: 'timestamp', width: 220, render: (value: string) => formatBeijingTime(value) },
    { title: '设备', render: (_: unknown, record: LogRecord) => record.resolved_device?.display_name ?? record.device_name ?? '-' },
    { title: '工具', dataIndex: 'tool_name' },
    { title: '意图', dataIndex: 'intent', render: (value?: string) => value ?? '-' },
    { title: '结果', dataIndex: 'result_status', render: (value: LogRecord['result_status']) => (value === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>) },
    { title: '耗时(ms)', dataIndex: 'duration_ms', width: 120 },
    { title: '操作', width: 100, render: (_: unknown, record: LogRecord) => <Button danger size="small" onClick={(event) => { event.stopPropagation(); void deleteLog(record.id ?? record.request_id); }}>删除</Button> },
  ];

  return (
    <div className="dashboard-shell">
      {contextHolder}
      <aside className="dashboard-nav">
        <div className="sider-brand">
          <div className="hero-kicker">TS MCP Runtime</div>
          <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>控制导航</Typography.Title>
          <Typography.Text style={{ color: 'rgba(255,255,255,0.72)' }}>快速切换各模块</Typography.Text>
        </div>
        <Menu theme="dark" mode="inline" defaultSelectedKeys={['devices']} items={[
          { key: 'devices', icon: <BulbOutlined />, label: '具体设备控制', onClick: () => scrollTo(deviceSectionRef) },
          { key: 'logs', icon: <FilterOutlined />, label: '日志查询', onClick: () => scrollTo(logsSectionRef) },
          { key: 'status', icon: <ThunderboltOutlined />, label: '系统状态', onClick: () => scrollTo(statusSectionRef) },
        ]} />
      </aside>

      <main className="app-shell">
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <Card bordered={false} className="page-header-card" style={{ background: 'linear-gradient(120deg, #0f172a, #1d4ed8)', color: '#fff' }}>
            <Row align="middle" gutter={16}>
              <Col flex="auto">
                <div className="hero-kicker">TS MCP Runtime</div>
                <Typography.Title level={2} className="hero-title">Home Assistant 设备控制中心</Typography.Title>
                <Typography.Text className="hero-desc">左侧导航栏用于在设备控制、日志查询和系统状态之间快速跳转。</Typography.Text>
              </Col>
              <Col><Tag color="processing" style={{ padding: '6px 12px', borderRadius: 999 }}>Online</Tag></Col>
            </Row>
          </Card>

          <Row gutter={16}>
            <Col xs={24} sm={12} lg={6}><Card bordered={false} className="metric-card"><Statistic prefix={<ApiOutlined />} title="总请求数" value={overview.total} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card bordered={false} className="metric-card"><Statistic prefix={<ThunderboltOutlined />} title="成功率" value={overview.successRate} suffix="%" precision={1} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card bordered={false} className="metric-card"><Statistic title="成功次数" value={overview.success} /></Card></Col>
            <Col xs={24} sm={12} lg={6}><Card bordered={false} className="metric-card"><Statistic title="失败次数" value={overview.failure} /></Card></Col>
          </Row>

          <section ref={deviceSectionRef}>
            <Card title={<Space><BulbOutlined />具体设备控制</Space>} bordered={false} className="section-card" extra={<Button danger disabled={selectedDeviceIds.length === 0} onClick={() => void deleteControlDevices(selectedDeviceIds.map(String))}>批量删除{selectedDeviceIds.length > 0 ? ` ${selectedDeviceIds.length}` : ''}</Button>}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Select style={{ width: '100%' }} value={deviceDomainFilter} options={deviceTypeOptions} onChange={setDeviceDomainFilter} placeholder="筛选设备类型" />
                <Select style={{ width: '100%' }} value={selectedDevice?.entity_id} placeholder="选择设备" options={filteredDevices.map((device) => ({ label: formatDeviceLabel(device), value: device.entity_id }))} onChange={(entityId) => { const nextDevice = devices.find((device) => device.entity_id === entityId) ?? null; setSelectedDevice(nextDevice); if (typeof nextDevice?.brightness === 'number') setBrightness(nextDevice.brightness); if (typeof nextDevice?.target_temperature === 'number') setTargetTemperature(nextDevice.target_temperature); }} />
                <Table size="small" rowKey="entity_id" pagination={{ pageSize: 5 }} dataSource={filteredDevices} rowSelection={{ selectedRowKeys: selectedDeviceIds, onChange: setSelectedDeviceIds }} columns={[{ title: '设备名', dataIndex: 'display_name' }, { title: 'entity_id', dataIndex: 'entity_id' }, { title: '类型', dataIndex: 'domain', render: (value?: string) => <Tag>{value ?? '-'}</Tag> }, { title: '状态', dataIndex: 'state', render: (value?: string) => <Tag color={value === 'on' ? 'green' : 'default'}>{value ?? '-'}</Tag> }, { title: '启用', dataIndex: 'enabled', render: (value?: boolean) => <Tag color={value === false ? 'red' : 'green'}>{value === false ? '禁用' : '启用'}</Tag> }, { title: '操作', dataIndex: 'entity_id', render: (_: unknown, record?: DeviceRecord) => record ? <Button danger size="small" onClick={(event) => { event.stopPropagation(); void deleteControlDevice(record.entity_id); }}>删除</Button> : null }]} onRow={(record) => ({ onClick: () => { if (!record) return; const nextDevice = devices.find((device) => device.entity_id === record.entity_id) ?? null; setSelectedDevice(nextDevice); } })} />
                {selectedDevice ? <Descriptions bordered size="small" column={1}><Descriptions.Item label="设备名">{selectedDevice.display_name}</Descriptions.Item><Descriptions.Item label="实体 ID">{selectedDevice.entity_id}</Descriptions.Item><Descriptions.Item label="显示名">{formatDeviceLabel(selectedDevice)}</Descriptions.Item><Descriptions.Item label="类型">{selectedDevice.domain ?? '-'}</Descriptions.Item><Descriptions.Item label="当前状态">{selectedDevice.state ?? '-'}</Descriptions.Item><Descriptions.Item label="房间">{selectedDevice.room ?? '-'}</Descriptions.Item><Descriptions.Item label="亮度能力">{selectedDevice.supports_brightness ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag>}</Descriptions.Item><Descriptions.Item label="色温能力">{selectedDevice.domain === 'light' ? <Tag color="green">支持</Tag> : <Tag>不适用</Tag>}</Descriptions.Item><Descriptions.Item label="色温范围">{selectedDevice.domain === 'light' ? `${selectedDevice.color_temp_min_kelvin ?? 3000}K ~ ${selectedDevice.color_temp_max_kelvin ?? 6400}K` : '-'}</Descriptions.Item><Descriptions.Item label="数值能力">{selectedDevice.supports_value ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag>}</Descriptions.Item><Descriptions.Item label="温度能力">{selectedDevice.supports_temperature ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag>}</Descriptions.Item><Descriptions.Item label="HVAC 模式">{selectedDevice.hvac_modes?.length ? selectedDevice.hvac_modes.join(', ') : '-'}</Descriptions.Item><Descriptions.Item label="传感器值">{selectedDevice.sensor_value === undefined ? '-' : `${selectedDevice.sensor_value}${selectedDevice.sensor_unit ?? ''}`}</Descriptions.Item><Descriptions.Item label="能力来源">{selectedDevice.capability_source === 'home_assistant' ? <Tag color="blue">Home Assistant</Tag> : <Tag>配置</Tag>}</Descriptions.Item></Descriptions> : null}
                {renderControlPanel()}
              </Space>
            </Card>
          </section>

          <section ref={logsSectionRef}>
            <Card title={<Space><FilterOutlined />日志查询与控制审计</Space>} bordered={false} className="section-card" extra={<Space><Tag color={logKeywordCount > 0 ? 'blue' : 'default'}>{logKeywordCount > 0 ? `已筛选 ${logKeywordCount}` : '未筛选'}</Tag><Button danger disabled={selectedLogIds.length === 0} onClick={() => void deleteSelectedLogs()}>批量删除{selectedLogIds.length > 0 ? ` ${selectedLogIds.length}` : ''}</Button><Button icon={<ReloadOutlined />} onClick={() => void refreshLogs()} loading={loading}>刷新</Button></Space>}>
              <Form form={form} component={false}>
                <Row gutter={[12, 12]} align="middle">
                  <Col xs={24} md={7}><Form.Item name="keyword" noStyle><Input allowClear placeholder="关键字 / 用户输入" /></Form.Item></Col>
                  <Col xs={24} md={5}><Form.Item name="tool_name" noStyle><Input allowClear placeholder="工具名" /></Form.Item></Col>
                  <Col xs={24} md={5}><Form.Item name="device_name" noStyle><Input allowClear placeholder="设备名" /></Form.Item></Col>
                  <Col xs={24} md={4}><Form.Item name="status" noStyle><Select allowClear placeholder="结果" options={[{ value: 'success', label: '成功' }, { value: 'failure', label: '失败' }]} /></Form.Item></Col>
                  <Col xs={24} md={3}><Space style={{ width: '100%', display: 'flex' }}><Button type="primary" icon={<SearchOutlined />} onClick={onSearch} loading={loading} style={{ width: '100%' }}>查询</Button><Button onClick={resetFilters} style={{ width: '100%' }}>重置</Button></Space></Col>
                </Row>
              </Form>
              <Alert style={{ marginTop: 16 }} type="info" showIcon message="支持按关键字、工具名、设备名和结果状态筛选。点击“重置”可恢复全部日志。" />
              <Table style={{ marginTop: 16 }} columns={logColumns} dataSource={logs} rowKey="id" loading={loading} rowSelection={{ selectedRowKeys: selectedLogIds, onChange: setSelectedLogIds }} pagination={{ pageSize: 8, showSizeChanger: true, pageSizeOptions: ['8', '16', '32'] }} onRow={(record) => ({ onClick: () => { setSelectedLog(record); setDrawerOpen(true); } })} />
            </Card>
          </section>

          <section ref={statusSectionRef}>
            <Row gutter={16} style={{ marginTop: 0 }}>
              <Col xs={24} lg={12}>
                <Card title="系统状态" bordered={false} className="section-card">
                  <Space direction="vertical"><Tag color="green">MCP Server Online</Tag><Tag color="green">Admin API Online</Tag><Tag color="blue">Home Assistant API Mapping Ready</Tag></Space>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="失败统计" bordered={false} className="section-card">
                  <Space direction="vertical" style={{ width: '100%' }}>{Object.entries(failureStats.byErrorCode).length === 0 ? <Typography.Text type="secondary">暂无失败</Typography.Text> : null}{Object.entries(failureStats.byErrorCode).map(([key, value]) => <Tag key={key} color="red">{key}: {value}</Tag>)}</Space>
                </Card>
              </Col>
            </Row>
          </section>

          <Card title={<Space><CompassOutlined />Home Assistant 设备自动发现与白名单</Space>} bordered={false} className="section-card" extra={<Button icon={<ReloadOutlined />} loading={discoverLoading} onClick={() => void discoverEntities()}>发现设备</Button>}>
            <Alert type="info" showIcon style={{ marginBottom: 16 }} message="页面加载时会自动发现一次 Home Assistant 设备。下面的表格同时支持发现浏览和白名单勾选。" />
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">发现实体 {discoveredEntityCount}</Tag>
              <Tag color="green">白名单设备 {databaseWhitelistCount}</Tag>
              <Tag color="gold">未暴露设备 {unexposedEntityCount}</Tag>
            </Space>
            <Space wrap style={{ marginBottom: 12 }}>
              <Input allowClear placeholder="按名称 / 设备名筛选" value={whitelistKeyword} onChange={(e) => setWhitelistKeyword(e.target.value)} style={{ width: 260 }} />
              <Select style={{ width: 180 }} value={whitelistDomainFilter} options={deviceTypeOptions} onChange={setWhitelistDomainFilter} />
              <Select style={{ width: 220 }} value={whitelistAreaFilter} options={[{ value: 'all', label: '全部区域' }, ...allAreas.map((area) => ({ value: area, label: area }))]} onChange={setWhitelistAreaFilter} />
              <Button onClick={() => { setWhitelistKeyword(''); setWhitelistDomainFilter('all'); setWhitelistAreaFilter('all'); }}>清除筛选</Button>
              <Button type="primary" onClick={() => void saveExposure()} loading={exposureLoading}>保存白名单</Button>
            </Space>
            <Space wrap style={{ marginBottom: 12 }}>
              <Button
                type={filteredWhitelistDevices.length > 0 && filteredWhitelistDevices.every((device) => exposedDevices.includes(device.entity_id)) ? 'primary' : 'default'}
                onClick={() => {
                  const filteredEntityIds = filteredWhitelistDevices.map((device) => device.entity_id);
                  const allSelected = filteredWhitelistDevices.length > 0 && filteredWhitelistDevices.every((device) => exposedDevices.includes(device.entity_id));
                  setExposedDevices((current) => allSelected
                    ? current.filter((id) => !filteredEntityIds.includes(id))
                    : Array.from(new Set([...current, ...filteredEntityIds])));
                }}
              >
                全选
              </Button>
            </Space>
            <Table rowKey="device_name" dataSource={whitelistDeviceRows} pagination={{ pageSize: 8 }} rowClassName={(record) => record && filteredWhitelistDevices.filter((device) => device.device_name === record.device_name).every((device) => exposedDevices.includes(device.entity_id)) ? 'exposure-row-exposed' : 'exposure-row-hidden'} expandable={{ expandedRowKeys: expandedDeviceNames, onExpandedRowsChange: (keys) => setExpandedDeviceNames(keys as string[]), expandRowByClick: true, expandedRowRender: (record) => { if (!record) return null; const deviceName = record.device_name ?? ''; const deviceEntities = filteredWhitelistDevices.filter((device) => device.device_name === deviceName); return <Space direction="vertical" style={{ width: '100%' }} size={10}>{deviceEntities.map((entity) => <Space key={entity.entity_id} style={{ width: '100%', justifyContent: 'space-between' }}><Checkbox checked={exposedDevices.includes(entity.entity_id)} onChange={(event) => toggleExposure(entity.entity_id, event.target.checked)}>{entity.friendly_name ?? entity.display_name}</Checkbox><Space size={6}><Tag>{entity.domain ?? '-'}</Tag><Typography.Text type="secondary">{entity.entity_id}</Typography.Text></Space></Space>)}</Space>; } }} columns={[{ title: '暴露', dataIndex: 'device_name', render: (_: unknown, record?: DeviceRecord) => { if (!record) return null; const deviceName = record.device_name ?? ''; const deviceEntities = filteredWhitelistDevices.filter((device) => device.device_name === deviceName); const entityIds = deviceEntities.map((device) => device.entity_id); const allChecked = entityIds.length > 0 && entityIds.every((entityId) => exposedDevices.includes(entityId)); return <Checkbox checked={allChecked} onChange={(event) => toggleDeviceExposure(deviceName, event.target.checked)} />; } }, { title: '设备名', dataIndex: 'device_name', render: (value?: string, record?: DeviceRecord) => value ?? record?.friendly_name ?? <Tag color="default">未关联设备</Tag> }, { title: '区域', dataIndex: 'area_name', render: (value?: string) => value ?? <Tag color="orange">未分配区域</Tag> }, { title: '类型', dataIndex: 'device_name', render: (_: unknown, record?: DeviceRecord) => { const domains = Array.from(new Set(filteredWhitelistDevices.filter((device) => device.device_name === record?.device_name).map((device) => device.domain).filter(Boolean))); return <Space wrap>{domains.map((domain) => <Tag key={domain}>{domain}</Tag>)}</Space>; } }, { title: '状态', dataIndex: 'enabled', render: (_: unknown, record?: DeviceRecord) => { const deviceEntities = filteredWhitelistDevices.filter((device) => device.device_name === record?.device_name); const enabled = deviceEntities.every((device) => device.enabled !== false); return <Tag color={enabled ? 'green' : 'red'}>{enabled ? '启用' : '禁用'}</Tag>; } }]} />
          </Card>
        </Space>

        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} width={680} title="日志详情">
          {selectedLog ? <Descriptions bordered column={1} size="small"><Descriptions.Item label="请求 ID">{selectedLog.request_id}</Descriptions.Item><Descriptions.Item label="时间">{selectedLog.timestamp}</Descriptions.Item><Descriptions.Item label="用户输入">{selectedLog.user_input ?? '-'}</Descriptions.Item><Descriptions.Item label="意图">{selectedLog.intent ?? '-'}</Descriptions.Item><Descriptions.Item label="MCP 工具">{selectedLog.tool_name}</Descriptions.Item><Descriptions.Item label="设备">{selectedLog.resolved_device?.display_name ?? selectedLog.device_name ?? '-'}</Descriptions.Item><Descriptions.Item label="entity_id">{selectedLog.resolved_device?.entity_id ?? '-'}</Descriptions.Item><Descriptions.Item label="结果">{selectedLog.result_status}</Descriptions.Item><Descriptions.Item label="错误码">{selectedLog.error_code ?? '-'}</Descriptions.Item><Descriptions.Item label="耗时(ms)">{selectedLog.duration_ms ?? '-'}</Descriptions.Item></Descriptions> : null}
        </Drawer>
      </main>
    </div>
  );
};
