import React, { useEffect, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Segmented, Typography, message } from 'antd'
import { KeyOutlined, SaveOutlined } from '@ant-design/icons'

interface OpenaiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

interface Settings {
  provider: 'qoder' | 'openai'
  openai: OpenaiSettings
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'qoder',
  openai: { baseUrl: '', apiKey: '', model: '' },
}

/**
 * 模型设置弹窗 — 默认走本机 Qoder CLI（零配置），也可切换 OpenAI 兼容 API
 *
 * 配置持久化到 userData 目录（asar 之外），保存后应用自动重启生效。
 */
export function SettingsModal({
  open,
  onClose,
  force = false,
}: {
  open: boolean
  onClose: () => void
  force?: boolean
}) {
  const [form] = Form.useForm()
  const [provider, setProvider] = useState<'qoder' | 'openai'>('qoder')
  const [settingsPath, setSettingsPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [messageApi, messageHolder] = message.useMessage()

  useEffect(() => {
    if (!open) return
    setSaved(false)
    ;(async () => {
      const res = await (window as any).electronAPI?.settings?.get?.()
      const settings: Settings = { ...DEFAULT_SETTINGS, ...(res?.settings || {}) }
      // 兼容旧配置：非 openai 一律视为 qoder
      setProvider(settings.provider === 'openai' ? 'openai' : 'qoder')
      setSettingsPath(res?.settingsPath || '')
      form.setFieldsValue({
        openaiApiKey: settings.openai?.apiKey || '',
        openaiBaseUrl: settings.openai?.baseUrl || '',
        openaiModel: settings.openai?.model || '',
      })
      setLoaded(true)
    })()
  }, [open, form])

  const handleSave = async () => {
    const api = (window as any).electronAPI?.settings
    if (!api || saving || saved) return
    // qoder 零配置免校验
    if (provider === 'openai' && !(form.getFieldValue('openaiApiKey') || '').trim()) {
      messageApi.warning('请填写 API Key')
      return
    }
    const values = form.getFieldsValue()
    const settings: Settings = {
      provider,
      openai: {
        apiKey: (values.openaiApiKey || '').trim(),
        baseUrl: (values.openaiBaseUrl || '').trim(),
        model: (values.openaiModel || '').trim(),
      },
    }
    setSaving(true)
    const res = await api.save(settings)
    setSaving(false)
    if (res?.success) {
      setSaved(true) // 主进程约 150ms 后自动重启
    } else {
      messageApi.error(res?.error || '保存失败')
    }
  }

  return (
    <>
      {messageHolder}
      <Modal
        title="模型设置"
        open={open}
        width={560}
        closable={!force}
        maskClosable={!force}
        keyboard={!force}
        onCancel={() => !force && onClose()}
        footer={(
          <div className="flex items-center justify-between gap-3">
            <Typography.Text type="secondary" className="!text-[11px] truncate max-w-[300px]" title={settingsPath}>
              <KeyOutlined className="mr-1" />
              {settingsPath || '配置保存在本地用户目录'}
            </Typography.Text>
            <Button
              type="primary"
              loading={saving}
              disabled={saved}
              icon={<SaveOutlined />}
              onClick={handleSave}
            >
              {saved ? '已保存，正在重启…' : '保存并重启'}
            </Button>
          </div>
        )}
      >
        {force && !saved && (
          <Alert
            type="warning"
            showIcon
            className="mb-4"
            message="尚未配置模型。默认使用本机 Qoder CLI（零配置），或切换到 OpenAI 兼容 API 填写密钥。"
          />
        )}

        <Segmented
          block
          className="mb-4"
          value={provider}
          onChange={value => setProvider(value as 'qoder' | 'openai')}
          options={[
            { value: 'qoder', label: '本机 Qoder（推荐）' },
            { value: 'openai', label: 'OpenAI 兼容 API' },
          ]}
        />

        {!loaded ? (
          <div className="py-10 text-center text-sm text-text-faint">加载中…</div>
        ) : provider === 'qoder' ? (
          <Alert
            type="info"
            showIcon
            message="零配置：复用本机 Qoder CLI 的登录与额度"
            description={(
              <div className="text-xs leading-5">
                <p>无需填写任何密钥，AI 调用走本机 qodercli，需先在终端执行一次：</p>
                <code className="block my-2 px-2 py-1 rounded bg-black/30 font-mono">qodercli login</code>
                <p>未登录时 AI 调用会提示登录，登录后无需改配置。</p>
              </div>
            )}
          />
        ) : (
          <Form form={form} layout="vertical" size="middle">
            <Form.Item name="openaiApiKey" label="API Key" required>
              <Input.Password placeholder="sk-your-api-key" spellCheck={false} />
            </Form.Item>
            <Form.Item name="openaiBaseUrl" label="Base URL">
              <Input placeholder="https://api.openai.com/v1" spellCheck={false} />
            </Form.Item>
            <Form.Item name="openaiModel" label="模型">
              <Input placeholder="gpt-4o" spellCheck={false} />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </>
  )
}

export default SettingsModal
