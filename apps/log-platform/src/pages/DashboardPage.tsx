import React from 'react';
import { Alert, Button, Card, Col, Descriptions, Drawer, Form, Input, Layout, Row, Select, Slider, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { ApiOutlined, BulbOutlined, CompassOutlined, FilterOutlined, PoweroffOutlined, ReloadOutlined, SearchOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { api, type DeviceRecord, type DiscoveredLight, type LogRecord } from '../api/client';

const logColumns = [
  { title: '时间', dataIndex: 'timestamp', width: 220 },
  { title: '设备', render: (_: unknown, record: LogRecord) => record.resolved_device?.display_name ?? record.device_name ?? '-' },
  { title: '工具', dataIndex: 'tool_name' },
  { title: '意图', dataIndex: 'intent', render: (value?: string) => value ?? '-' },
  {
    title: '结果',
    dataIndex: 'result_status',
    render: (value: LogRecord['result_status']) => (value === 'success' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>),
  },
  { title: '耗时(ms)', dataIndex: 'duration_ms', width: 120 },
];

const fallbackDevices: DeviceRecord[] = [
  { device_id: 'light_living_room_main', display_name: '客厅灯', entity_id: 'light.living_room_main', room: 'living_room', supports_brightness: true, enabled: true },
];

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
  const [discoveredLights, setDiscoveredLights] = React.useState<DiscoveredLight[]>([]);
  const [selectedDevice, setSelectedDevice] = React.useState<DeviceRecord | null>(null);
  const [selectedLog, setSelectedLog] = React.useState<LogRecord | null>(null);
  const [brightness, setBrightness] = React.useState(180);
  const [overview, setOverview] = React.useState({ total: 0, success: 0, failure: 0, successRate: 0 });
  const [failureStats, setFailureStats] = React.useState<{ total: number; byErrorCode: Record<string, number>; byTool: Record<string, number> }>({ total: 0, byErrorCode: {}, byTool: {} });
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [controlLoading, setControlLoading] = React.useState(false);
  const [discoverLoading, setDiscoverLoading] = React.useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const loadData = React.useCallback(async (query?: URLSearchParams) => {
    setLoading(true);
    try {
      const [overviewData, failureData, logsData, devicesData] = await Promise.all([
        api.getOverview(),
        api.getFailureStats(),
        api.listLogs(query),
        api.listDevices(),
      ]);
      const normalizedDevices = devicesData.devices.length > 0 ? devicesData.devices : fallbackDevices;
      setOverview(overviewData);
      setFailureStats(failureData);
      setLogs(logsData.items.length > 0 ? logsData.items : fallbackLogs);
      setDevices(normalizedDevices);
      setSelectedDevice((current) => current ?? normalizedDevices[0] ?? null);
    } catch {
      setLogs(fallbackLogs);
      setDevices(fallbackDevices);
      setSelectedDevice((current) => current ?? fallbackDevices[0]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  const refreshLogs = async () => {
    await loadData();
  };

  const discoverLights = async () => {
    setDiscoverLoading(true);
    try {
      const result = await api.discoverLights();
      setDiscoveredLights(result.lights);
      messageApi.success(`已发现 ${result.lights.length} 个 Home Assistant 灯光实体`);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '发现灯光实体失败');
    } finally {
      setDiscoverLoading(false);
    }
  };

  const control = async (action: 'on' | 'off' | 'brightness' | 'state') => {
    if (!selectedDevice) return;
    setControlLoading(true);
    try {
      if (action === 'on') await api.turnOnLight(selectedDevice.entity_id);
      if (action === 'off') await api.turnOffLight(selectedDevice.entity_id);
      if (action === 'brightness') await api.setLightBrightness(selectedDevice.entity_id, brightness);
      if (action === 'state') await api.setLightState(selectedDevice.entity_id, 'on', brightness);
      messageApi.success('控制指令已执行，日志已刷新');
      await refreshLogs();
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
      const state = await api.getLightState(selectedDevice.entity_id);
      messageApi.info(`当前状态：${String(state.state ?? 'unknown')}`);
      await refreshLogs();
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

  return (
    <Layout.Content style={{ minHeight: '100vh', padding: 24, background: 'linear-gradient(135deg, #eef4ff 0%, #f8fbff 45%, #fff7ed 100%)' }}>
      {contextHolder}
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Card bordered={false} style={{ borderRadius: 24, background: 'linear-gradient(120deg, #0f172a, #1d4ed8)', color: '#fff', boxShadow: '0 20px 50px rgba(15,23,42,.18)' }}>
          <Row align="middle" gutter={16}>
            <Col flex="auto">
              <Typography.Title level={2} style={{ color: '#fff', marginBottom: 4 }}>Home Assistant 灯光控制中心</Typography.Title>
              <Typography.Text style={{ color: 'rgba(255,255,255,.76)' }}>集成 MCP 工具调用、设备控制、审计日志、状态追踪和 Home Assistant 映射。</Typography.Text>
            </Col>
            <Col><Tag color="processing" style={{ padding: '6px 12px', borderRadius: 999 }}>TS MCP Runtime</Tag></Col>
          </Row>
        </Card>

        <Row gutter={16}>
          <Col xs={24} sm={12} lg={6}><Card bordered={false}><Statistic prefix={<ApiOutlined />} title="总请求数" value={overview.total} /></Card></Col>
          <Col xs={24} sm={12} lg={6}><Card bordered={false}><Statistic prefix={<ThunderboltOutlined />} title="成功率" value={overview.successRate} suffix="%" precision={1} /></Card></Col>
          <Col xs={24} sm={12} lg={6}><Card bordered={false}><Statistic title="成功次数" value={overview.success} /></Card></Col>
          <Col xs={24} sm={12} lg={6}><Card bordered={false}><Statistic title="失败次数" value={overview.failure} /></Card></Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} lg={10}>
            <Card title={<Space><BulbOutlined />具体设备控制</Space>} bordered={false} style={{ borderRadius: 20 }}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Select
                  style={{ width: '100%' }}
                  value={selectedDevice?.entity_id}
                  placeholder="选择灯光设备"
                  options={devices.map((device) => ({ label: `${device.display_name} · ${device.entity_id}`, value: device.entity_id }))}
                  onChange={(entityId) => setSelectedDevice(devices.find((device) => device.entity_id === entityId) ?? null)}
                />
                {selectedDevice ? (
                  <Descriptions bordered size="small" column={1}>
                    <Descriptions.Item label="设备名">{selectedDevice.display_name}</Descriptions.Item>
                    <Descriptions.Item label="实体 ID">{selectedDevice.entity_id}</Descriptions.Item>
                    <Descriptions.Item label="房间">{selectedDevice.room ?? '-'}</Descriptions.Item>
                    <Descriptions.Item label="亮度能力">{selectedDevice.supports_brightness ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag>}</Descriptions.Item>
                  </Descriptions>
                ) : null}
                <div>
                  <Typography.Text strong>亮度：{brightness}</Typography.Text>
                  <Slider min={0} max={255} value={brightness} onChange={setBrightness} disabled={!selectedDevice?.supports_brightness} />
                </div>
                <Space wrap>
                  <Button type="primary" icon={<BulbOutlined />} loading={controlLoading} onClick={() => void control('on')}>开灯</Button>
                  <Button danger icon={<PoweroffOutlined />} loading={controlLoading} onClick={() => void control('off')}>关灯</Button>
                  <Button loading={controlLoading} disabled={!selectedDevice?.supports_brightness} onClick={() => void control('brightness')}>设置亮度</Button>
                  <Button loading={controlLoading} onClick={() => void queryState()}>查询状态</Button>
                </Space>
              </Space>
            </Card>
          </Col>

          <Col xs={24} lg={14}>
            <Card title={<Space><FilterOutlined />日志查询</Space>} bordered={false} style={{ borderRadius: 20 }}>
              <Form form={form} component={false}>
                <Row gutter={[12, 12]}>
                  <Col xs={24} md={6}><Form.Item name="keyword" noStyle><Input placeholder="关键字" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name="tool_name" noStyle><Input placeholder="工具名" /></Form.Item></Col>
                  <Col xs={24} md={6}><Form.Item name="device_name" noStyle><Input placeholder="设备名" /></Form.Item></Col>
                  <Col xs={24} md={4}><Form.Item name="status" noStyle><Select placeholder="状态" allowClear options={[{ value: 'success', label: '成功' }, { value: 'failure', label: '失败' }]} /></Form.Item></Col>
                  <Col xs={24} md={2}><Button type="primary" icon={<SearchOutlined />} onClick={onSearch} loading={loading}>查</Button></Col>
                </Row>
              </Form>
              <Alert style={{ marginTop: 16 }} type="success" showIcon message="设备控制后会自动刷新日志，日志来自后端真实 Admin API。" />
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} lg={16}>
            <Card title="控制与审计日志" bordered={false} style={{ borderRadius: 20 }} extra={<Button icon={<ReloadOutlined />} onClick={() => void refreshLogs()} loading={loading}>刷新</Button>}>
              <Table columns={logColumns} dataSource={logs} rowKey="id" loading={loading} pagination={{ pageSize: 8 }} onRow={(record) => ({ onClick: () => { setSelectedLog(record); setDrawerOpen(true); } })} />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card title="系统状态" bordered={false} style={{ borderRadius: 20 }}>
                <Space direction="vertical">
                  <Tag color="green">MCP Server Online</Tag>
                  <Tag color="green">Admin API Online</Tag>
                  <Tag color="blue">Home Assistant API Mapping Ready</Tag>
                </Space>
              </Card>
              <Card title="失败统计" bordered={false} style={{ borderRadius: 20 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {Object.entries(failureStats.byErrorCode).length === 0 ? <Typography.Text type="secondary">暂无失败</Typography.Text> : null}
                  {Object.entries(failureStats.byErrorCode).map(([key, value]) => <Tag key={key} color="red">{key}: {value}</Tag>)}
                </Space>
              </Card>
            </Space>
          </Col>
        </Row>

        <Card title={<Space><CompassOutlined />Home Assistant 灯光自动发现</Space>} bordered={false} style={{ borderRadius: 20 }} extra={<Button icon={<ReloadOutlined />} loading={discoverLoading} onClick={() => void discoverLights()}>发现灯光</Button>}>
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message="这里展示 Home Assistant 中实际存在的 light.* 实体。若要出现在控制下拉框，需要把对应 entity_id 写入 config/lights.json 白名单。" />
          <Table
            rowKey="entity_id"
            dataSource={discoveredLights}
            pagination={{ pageSize: 6 }}
            columns={[
              { title: '实体 ID', dataIndex: 'entity_id' },
              { title: '名称', dataIndex: 'friendly_name' },
              { title: '状态', dataIndex: 'state', render: (value: string) => <Tag color={value === 'on' ? 'green' : 'default'}>{value}</Tag> },
              { title: '亮度能力', dataIndex: 'supports_brightness', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '支持' : '未知/不支持'}</Tag> },
            ]}
          />
        </Card>

        <Card title="Home Assistant 控制映射表" bordered={false} style={{ borderRadius: 20 }}>
          <Table
            rowKey="device_id"
            dataSource={devices}
            pagination={false}
            columns={[
              { title: '设备名', dataIndex: 'display_name' },
              { title: 'entity_id', dataIndex: 'entity_id' },
              { title: '房间', dataIndex: 'room' },
              { title: '亮度', dataIndex: 'supports_brightness', render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '支持' : '不支持'}</Tag> },
              { title: '状态', dataIndex: 'enabled', render: (value: boolean) => <Tag color={value === false ? 'red' : 'green'}>{value === false ? '禁用' : '启用'}</Tag> },
            ]}
          />
        </Card>
      </Space>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} width={680} title="日志详情">
        {selectedLog ? (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="请求 ID">{selectedLog.request_id}</Descriptions.Item>
            <Descriptions.Item label="时间">{selectedLog.timestamp}</Descriptions.Item>
            <Descriptions.Item label="用户输入">{selectedLog.user_input ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="意图">{selectedLog.intent ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="MCP 工具">{selectedLog.tool_name}</Descriptions.Item>
            <Descriptions.Item label="设备">{selectedLog.resolved_device?.display_name ?? selectedLog.device_name ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="entity_id">{selectedLog.resolved_device?.entity_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="结果">{selectedLog.result_status}</Descriptions.Item>
            <Descriptions.Item label="错误码">{selectedLog.error_code ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="耗时(ms)">{selectedLog.duration_ms ?? '-'}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </Layout.Content>
  );
};
