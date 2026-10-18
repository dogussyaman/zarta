import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

vi.mock('./lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}))

import App from './App'

describe('Zarta entry experience', () => {
  it('does not simulate a room when Supabase is not configured', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: /biraz bilgi/i })).toBeInTheDocument()
    expect(screen.getByText(/supabase bağlantısı kurulmalı/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /4 adımda zarta/i })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /oyun nasıl oynanır/i })).toHaveTextContent('Odaya katıl')
    expect(screen.getByRole('list', { name: /oyun nasıl oynanır/i })).toHaveTextContent('Blöfünü yaz')
    expect(screen.getByRole('list', { name: /oyun nasıl oynanır/i })).toHaveTextContent('Gerçeği seç')
    expect(screen.getByRole('button', { name: /oda oluştur/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /katıl/i })).toBeDisabled()
    expect(screen.getByText('KURULUM GEREKLİ')).toBeInTheDocument()
  })

  it('opens the profile dialog and lets the player choose a persistent character', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /profili düzenle/i }))

    const dialog = screen.getByRole('dialog', { name: /profili düzenle/i })
    const characterPicker = within(within(dialog).getByRole('group', { name: 'Oyuncu karakteri' }))
    expect(within(dialog).getByLabelText('Oyuncu adın')).toBeInTheDocument()
    expect(characterPicker.getAllByRole('button')).toHaveLength(10)

    fireEvent.click(characterPicker.getByRole('button', { name: 'Panda' }))

    expect(characterPicker.getByRole('button', { name: 'Panda' })).toHaveAttribute('aria-pressed', 'true')
    expect(characterPicker.getByRole('button', { name: 'Kıvılcım' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByRole('button', { name: /profili kaydet/i })).toBeDisabled()
  })

  it('allows selecting exactly one category in the room setup dialog', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Oyun kurallarını aç' }))

    const dialog = screen.getByRole('dialog', { name: 'Masayı sen kur' })
    const categoryPicker = within(dialog).getByRole('radiogroup', { name: 'Oyun kategorisi' })
    const categories = within(categoryPicker).getAllByRole('radio')
    expect(categories).toHaveLength(9)
    expect(categories.filter((item) => (item as HTMLInputElement).checked)).toHaveLength(1)

    fireEvent.click(within(categoryPicker).getByRole('radio', { name: 'Film ve dizi' }))

    expect(within(categoryPicker).getByRole('radio', { name: 'Film ve dizi' })).toBeChecked()
    expect(within(categoryPicker).getAllByRole('radio').filter((item) => (item as HTMLInputElement).checked)).toHaveLength(1)
  })

  it('renders accessible shadcn-style selects for round settings', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Oyun kurallarını aç' }))

    const dialog = screen.getByRole('dialog', { name: 'Masayı sen kur' })
    expect(await within(dialog).findByRole('combobox', { name: 'Tur sayısı' })).toHaveTextContent('5 tur')
    expect(await within(dialog).findByRole('combobox', { name: 'Cevap süresi' })).toHaveTextContent('20 saniye')
  })
})
