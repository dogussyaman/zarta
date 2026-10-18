import { useState } from 'react'
import { X, Send } from 'lucide-react'

export type ChatMessage = {
  id: string
  sender: string
  avatarKey?: string
  text: string
  time: string
  isMe?: boolean
}

const QUICK_REACTIONS = ['😂', '🔥', '👑', '👀', '🤫', 'Zartaladım!', 'Tüh be!', 'Blöfüm nasıl?']

export function GameChat({
  isOpen,
  onClose,
  myName,
  myAvatarKey,
}: {
  isOpen: boolean
  onClose: () => void
  myName: string
  myAvatarKey: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'ILgaz55',
      avatarKey: 'spark',
      text: 'Odaya hoş geldiniz! Kimler Zartalanmaya hazır? 😎',
      time: '19:42',
      isMe: false,
    },
    {
      id: '2',
      sender: 'yamnndgs',
      avatarKey: 'panda',
      text: 'Bu sefer kandıramazsın, doğru cevabı biliyorum! 🐼',
      time: '19:43',
      isMe: false,
    },
  ])
  const [draft, setDraft] = useState('')

  if (!isOpen) return null

  const handleSend = (textToSend?: string) => {
    const text = (textToSend ?? draft).trim()
    if (!text) return
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: myName || 'Sen',
      avatarKey: myAvatarKey,
      text,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
      isMe: true,
    }
    setMessages((prev) => [...prev, newMsg])
    if (!textToSend) setDraft('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-sm bg-[#16213e] border-2 border-[#2b3a67] rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
        {/* Chat Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#0f172a] border-b border-[#2b3a67]">
          <div className="flex items-center gap-2">
            <span className="text-xl">💬</span>
            <h3 className="font-bold text-white text-lg font-heading">Oda Sohbeti</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#1e293b] text-gray-300 hover:text-white flex items-center justify-center transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[220px]">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.isMe ? 'items-end' : 'items-start'}`}
            >
              <span className="text-[11px] text-gray-400 font-semibold mb-0.5 px-1">
                {msg.isMe ? 'Sen' : msg.sender} • {msg.time}
              </span>
              <div
                className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm font-medium ${
                  msg.isMe
                    ? 'bg-[#2563eb] text-white rounded-tr-sm shadow-md'
                    : 'bg-[#334155] text-white rounded-tl-sm shadow-md'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>

        {/* Quick Reactions Bar */}
        <div className="px-3 py-2 bg-[#1e293b] flex gap-1.5 overflow-x-auto no-scrollbar border-t border-[#334155]">
          {QUICK_REACTIONS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => handleSend(item)}
              className="px-2.5 py-1 bg-[#0f172a] hover:bg-[#3b82f6] text-white text-xs font-semibold rounded-full border border-[#475569] whitespace-nowrap transition active:scale-95"
            >
              {item}
            </button>
          ))}
        </div>

        {/* Input Dock */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="p-3 bg-[#0f172a] flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Mesaj yaz..."
            className="flex-1 px-4 py-2.5 rounded-full bg-[#1e293b] text-white placeholder-gray-400 text-sm border border-[#334155] focus:outline-none focus:border-[#3b82f6]"
            maxLength={100}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="w-10 h-10 rounded-full bg-[#3b82f6] disabled:opacity-40 text-white flex items-center justify-center transition active:scale-95 shadow-md shrink-0"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
