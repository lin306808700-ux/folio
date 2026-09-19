// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 lin306808700-ux

import React, { useState, useRef } from 'react'
import { X, Upload, ChevronDown, Check, Calendar } from 'lucide-react'
import type { RichFormData, RichFormField } from '../types'

interface RichFormCardProps {
  formData: RichFormData
  messageId: string
  submitted?: boolean
  submittedValues?: Record<string, any>
  onSubmit: (values: Record<string, any>) => void
  onCancel: () => void
}

export function RichFormCard({ formData, messageId, submitted, submittedValues, onSubmit, onCancel }: RichFormCardProps) {
  const [values, setValues] = useState<Record<string, any>>(() => buildInitialValues(formData.fields))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)

  function buildInitialValues(fields: RichFormField[]) {
    const init: Record<string, any> = {}
    fields.forEach(f => {
      if (f.type === 'multi_select') init[f.id] = []
      else if (f.type === 'date_range') init[f.id] = { start: '', end: '' }
      else init[f.id] = ''
    })
    return init
  }

  function setValue(id: string, val: any) {
    setValues(prev => ({ ...prev, [id]: val }))
    if (errors[id]) setErrors(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  function validate() {
    const newErrors: Record<string, string> = {}
    formData.fields.forEach(f => {
      if (!f.required) return
      const val = values[f.id]
      if (f.type === 'multi_select' && (!val || val.length === 0)) {
        newErrors[f.id] = '请至少选择一项'
      } else if (f.type === 'date_range') {
        if (!val?.start || !val?.end) newErrors[f.id] = '请选择完整的时间范围'
      } else if (!val || val === '') {
        newErrors[f.id] = '此字段为必填项'
      }
    })
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSubmit() {
    if (!validate()) return
    onSubmit(values)
  }

  if (submitted && submittedValues) {
    return <SubmittedSummary formData={formData} values={submittedValues} />
  }

  return (
    <div className="mt-2 rounded-2xl border border-violet-500/20 bg-surface dark:bg-slate-900/80 overflow-hidden shadow-lg shadow-violet-900/10 max-w-[480px]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle dark:border-white/5 bg-violet-500/[0.06] dark:bg-gradient-to-r dark:from-violet-900/20 dark:to-transparent">
        <div className="w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-sm">
          📋
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text-primary dark:text-slate-200">{formData.title}</div>
          {formData.description && (
            <div className="text-[11px] text-text-muted dark:text-slate-500 mt-0.5">{formData.description}</div>
          )}
        </div>
        <button
          onClick={onCancel}
          className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted dark:text-slate-500 hover:text-text-primary dark:hover:text-slate-300 hover:bg-text-primary/[0.05] dark:hover:bg-white/5 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Fields */}
      <div className="px-4 py-3 flex flex-col gap-3">
        {formData.fields.map(field => (
          <FieldRenderer
            key={field.id}
            field={field}
            value={values[field.id]}
            error={errors[field.id]}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            onChange={val => setValue(field.id, val)}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle dark:border-white/5">
        <button
          onClick={handleSubmit}
          className="flex-1 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-[13px] font-medium transition-colors"
        >
          提交
        </button>
        <button
          onClick={onCancel}
          className="py-2 px-4 rounded-lg border border-border-subtle dark:border-white/10 text-text-muted dark:text-slate-400 hover:text-text-primary dark:hover:text-slate-200 hover:border-border-strong dark:hover:border-white/20 text-[13px] transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  )
}

// ── 单字段渲染 ──────────────────────────────────────────────
interface FieldRendererProps {
  field: RichFormField
  value: any
  error?: string
  openDropdown: string | null
  setOpenDropdown: (id: string | null) => void
  onChange: (val: any) => void
}

function FieldRenderer({ field, value, error, openDropdown, setOpenDropdown, onChange }: FieldRendererProps) {
  const baseInputCls = `w-full bg-inset dark:bg-slate-800/80 border rounded-lg px-3 py-2 text-[13px] text-text-primary dark:text-slate-200 placeholder-text-faint dark:placeholder-slate-600 outline-none transition-colors
    ${error ? 'border-red-500/50 focus:border-red-400/70' : 'border-border-subtle dark:border-white/10 focus:border-violet-400/50'}`

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] text-text-muted dark:text-slate-400 flex items-center gap-1">
        {field.label}
        {field.required && <span className="text-red-400">*</span>}
      </label>

      {field.type === 'text' && (
        <input
          type="text"
          className={baseInputCls}
          placeholder={field.placeholder || `请输入${field.label}`}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          className={baseInputCls}
          placeholder={field.placeholder || `请输入${field.label}`}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}

      {field.type === 'textarea' && (
        <textarea
          className={`${baseInputCls} resize-none min-h-[72px]`}
          placeholder={field.placeholder || `请输入${field.label}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
        />
      )}

      {field.type === 'date' && (
        <input
          type="date"
          className={baseInputCls}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      )}

      {field.type === 'date_range' && (
        <DateRangeField
          value={value}
          field={field}
          error={error}
          onChange={onChange}
        />
      )}

      {field.type === 'select' && (
        <SelectField
          field={field}
          value={value}
          error={error}
          isOpen={openDropdown === field.id}
          onToggle={() => setOpenDropdown(openDropdown === field.id ? null : field.id)}
          onChange={val => { onChange(val); setOpenDropdown(null) }}
        />
      )}

      {field.type === 'multi_select' && (
        <MultiSelectField
          field={field}
          value={value}
          error={error}
          isOpen={openDropdown === field.id}
          onToggle={() => setOpenDropdown(openDropdown === field.id ? null : field.id)}
          onChange={onChange}
        />
      )}

      {field.type === 'radio' && (
        <RadioField field={field} value={value} onChange={onChange} />
      )}

      {field.type === 'image_upload' && (
        <ImageUploadField value={value} onChange={onChange} error={error} />
      )}

      {error && <span className="text-[11px] text-red-400">{error}</span>}
    </div>
  )
}

// ── Select ──────────────────────────────────────────────────
function SelectField({ field, value, error, isOpen, onToggle, onChange }: {
  field: RichFormField; value: string; error?: string
  isOpen: boolean; onToggle: () => void; onChange: (v: string) => void
}) {
  const selectedLabel = field.options?.find(o => o.value === value)?.label
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between bg-inset dark:bg-slate-800/80 border rounded-lg px-3 py-2 text-[13px] transition-colors text-left
          ${error ? 'border-red-500/50' : isOpen ? 'border-violet-400/50' : 'border-border-subtle dark:border-white/10 hover:border-border-strong dark:hover:border-white/20'}`}
      >
        <span className={selectedLabel ? 'text-text-primary dark:text-slate-200' : 'text-text-faint dark:text-slate-600'}>
          {selectedLabel || (field.placeholder || `选择${field.label}`)}
        </span>
        <ChevronDown size={13} className={`text-text-muted dark:text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-elevated dark:bg-slate-800 border border-border-subtle dark:border-white/10 rounded-lg overflow-hidden shadow-xl">
          {field.options?.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between transition-colors
                ${value === opt.value ? 'bg-violet-600/20 text-violet-600 dark:text-violet-300' : 'text-text-secondary dark:text-slate-300 hover:bg-text-primary/[0.04] dark:hover:bg-white/5'}`}
            >
              {opt.label}
              {value === opt.value && <Check size={12} className="text-violet-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Multi Select ────────────────────────────────────────────
function MultiSelectField({ field, value, error, isOpen, onToggle, onChange }: {
  field: RichFormField; value: string[]; error?: string
  isOpen: boolean; onToggle: () => void; onChange: (v: string[]) => void
}) {
  function toggle(optValue: string) {
    const current: string[] = value || []
    onChange(current.includes(optValue) ? current.filter(v => v !== optValue) : [...current, optValue])
  }

  const selectedLabels = (value || []).map(v => field.options?.find(o => o.value === v)?.label).filter(Boolean)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between bg-inset dark:bg-slate-800/80 border rounded-lg px-3 py-2 text-[13px] transition-colors text-left min-h-[36px]
          ${error ? 'border-red-500/50' : isOpen ? 'border-violet-400/50' : 'border-border-subtle dark:border-white/10 hover:border-border-strong dark:hover:border-white/20'}`}
      >
        {selectedLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedLabels.map(label => (
              <span key={label} className="px-1.5 py-0.5 rounded-md bg-violet-500/20 border border-violet-500/25 text-violet-600 dark:text-violet-300 text-[11px]">
                {label}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-text-faint dark:text-slate-600">{field.placeholder || `选择${field.label}（多选）`}</span>
        )}
        <ChevronDown size={13} className={`text-text-muted dark:text-slate-500 ml-2 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-elevated dark:bg-slate-800 border border-border-subtle dark:border-white/10 rounded-lg overflow-hidden shadow-xl">
          {field.options?.map(opt => {
            const checked = (value || []).includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className={`w-full text-left px-3 py-2 text-[13px] flex items-center gap-2 transition-colors
                  ${checked ? 'text-violet-600 dark:text-violet-300' : 'text-text-secondary dark:text-slate-300 hover:bg-text-primary/[0.04] dark:hover:bg-white/5'}`}
              >
                <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center
                  ${checked ? 'bg-violet-600 border-violet-500' : 'border-border-strong dark:border-white/20'}`}>
                  {checked && <Check size={10} className="text-white" />}
                </span>
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Radio ───────────────────────────────────────────────────
function RadioField({ field, value, onChange }: { field: RichFormField; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {field.options?.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors
            ${value === opt.value
              ? 'bg-violet-600/20 border-violet-500/40 text-violet-600 dark:text-violet-300'
              : 'border-border-subtle dark:border-white/10 text-text-muted dark:text-slate-400 hover:border-border-strong dark:hover:border-white/20 hover:text-text-secondary dark:hover:text-slate-300'}`}
        >
          <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0
            ${value === opt.value ? 'border-violet-400 bg-violet-400' : 'border-text-muted dark:border-slate-500'}`} />
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── DateRange ───────────────────────────────────────────────
function DateRangeField({ value, field, error, onChange }: {
  value: { start: string; end: string }; field: RichFormField; error?: string; onChange: (v: any) => void
}) {
  const baseCls = `flex-1 bg-inset dark:bg-slate-800/80 border rounded-lg px-3 py-2 text-[13px] text-text-primary dark:text-slate-200 outline-none transition-colors
    ${error ? 'border-red-500/50' : 'border-border-subtle dark:border-white/10 focus:border-violet-400/50'}`
  return (
    <div className="flex items-center gap-2">
      <input type="date" className={baseCls} value={value?.start || ''} onChange={e => onChange({ ...value, start: e.target.value })} />
      <span className="text-text-faint dark:text-slate-600 text-[12px] flex-shrink-0">→</span>
      <input type="date" className={baseCls} value={value?.end || ''} onChange={e => onChange({ ...value, end: e.target.value })} />
    </div>
  )
}

// ── Image Upload ────────────────────────────────────────────
function ImageUploadField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => onChange(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  return (
    <label
      className={`flex flex-col items-center justify-center gap-1.5 border border-dashed rounded-xl py-4 cursor-pointer transition-colors
        ${error ? 'border-red-500/50' : 'border-border-strong dark:border-white/15 hover:border-violet-400/40 hover:bg-violet-500/5'}
        ${value ? 'p-0 border-solid border-border-subtle dark:border-white/10' : ''}`}
      onClick={() => !value && fileInputRef.current?.click()}
    >
      {value ? (
        <div className="relative w-full">
          <img src={value} alt="preview" className="w-full max-h-32 object-cover rounded-xl" />
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onChange('') }}
            className="absolute top-2 right-2 w-6 h-6 rounded-md bg-black/60 flex items-center justify-center text-white/80 hover:bg-black/80"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <>
          <Upload size={18} className="text-text-muted dark:text-slate-500" />
          <span className="text-[12px] text-text-muted dark:text-slate-500">点击上传图片</span>
          <span className="text-[10px] text-text-faint dark:text-slate-600">PNG / JPG</span>
        </>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </label>
  )
}

// ── Submitted Summary ───────────────────────────────────────
function SubmittedSummary({ formData, values }: { formData: RichFormData; values: Record<string, any> }) {
  return (
    <div className="mt-2 rounded-2xl border border-emerald-500/20 bg-surface dark:bg-slate-900/60 overflow-hidden max-w-[480px]">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle dark:border-white/5 bg-emerald-500/[0.08] dark:bg-emerald-900/10">
        <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
        <span className="text-[12px] text-emerald-600 dark:text-emerald-400">{formData.title} · 已提交</span>
      </div>
      <div className="px-4 py-3 flex flex-col gap-1.5">
        {formData.fields.filter(f => f.type !== 'image_upload').map(f => {
          const val = values[f.id]
          if (!val || val === '' || (Array.isArray(val) && val.length === 0)) return null
          let display = ''
          if (f.type === 'multi_select' && Array.isArray(val)) {
            display = val.map((v: string) => f.options?.find(o => o.value === v)?.label || v).join('、')
          } else if (f.type === 'select') {
            display = f.options?.find(o => o.value === val)?.label || val
          } else if (f.type === 'radio') {
            display = f.options?.find(o => o.value === val)?.label || val
          } else if (f.type === 'date_range' && val?.start && val?.end) {
            display = `${val.start} → ${val.end}`
          } else {
            display = String(val)
          }
          return (
            <div key={f.id} className="flex items-start gap-2 text-[12px]">
              <span className="text-text-muted dark:text-slate-500 flex-shrink-0 w-16 truncate">{f.label}</span>
              <span className="text-text-secondary dark:text-slate-300">{display}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
