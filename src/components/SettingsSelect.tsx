import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

type SelectOption = {
  value: number
  label: string
}

export function SettingsSelect({
  id,
  labelId,
  value,
  options,
  onValueChange,
}: {
  id: string
  labelId: string
  value: number
  options: SelectOption[]
  onValueChange: (value: number) => void
}) {
  return (
    <Select.Root value={String(value)} onValueChange={(nextValue) => onValueChange(Number(nextValue))}>
      <Select.Trigger id={id} className="settings-select-trigger" aria-labelledby={labelId}>
        <Select.Value />
        <Select.Icon className="settings-select-icon"><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="settings-select-content" position="popper" sideOffset={5} collisionPadding={10}>
          <Select.Viewport className="settings-select-viewport">
            {options.map((option) => (
              <Select.Item className="settings-select-item" value={String(option.value)} key={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="settings-select-item-indicator"><Check size={14} /></Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
