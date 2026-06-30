import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, Layout } from 'antd';
import 'antd/dist/reset.css';
import { DashboardPage } from './pages/DashboardPage';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 12,
          fontFamily: 'Inter, system-ui, sans-serif',
        },
      }}
    >
      <Layout style={{ minHeight: '100vh', background: '#f5f7fb' }}>
        <DashboardPage />
      </Layout>
    </ConfigProvider>
  </React.StrictMode>,
);
