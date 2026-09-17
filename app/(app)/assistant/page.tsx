"use client"

import * as React from "react"
import useSWR from "swr"
import { Bot, Send, User, Sparkles } from "lucide-react"
import { SectionHeading } from "@/components/intel/shared"
import { CaseSelect } from "@/components/intel/case-select"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/feedback"
import { fetcher, apiPost, useCases } from "@/lib/client/hooks"

interface AssistantAnswer {
  answer: string
  sources: string[]
  provenance: string
}
interface Message {
  role: "user" | "assistant"
  text: string
  sources?: string[]
  provenance?: string
}

export default function AssistantPage() {
  const { data: casesData } = useCases()
  const [caseId, setCaseId] = React.useState("")
  const effectiveId = caseId || casesData?.cases[0]?.id || ""
  const { data: sugg } = useSWR<{ suggestions: string[] }>("/api/trace-assistant", fetcher)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    setMessages([])
  }, [effectiveId])

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, loading])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || !effectiveId || loading) return
    setInput("")
    setMessages((m) => [...m, { role: "user", text: q }])
    setLoading(true)
    try {
      const res = await apiPost<{ answer: AssistantAnswer }>("/api/trace-assistant", { question: q, caseId: effectiveId })
      setMessages((m) => [
        ...m,
        { role: "assistant", text: res.answer.answer, sources: res.answer.sources, provenance: res.answer.provenance },
      ])
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e instanceof Error ? e.message : "Query failed." }])
    } finally {
      setLoading(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      ask(input)
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col space-y-4">
      <SectionHeading
        title="TRACE Assistant"
        description="An investigation copilot that answers strictly from computed results for the selected case — no fabrication, always with provenance."
      />

      <CaseSelect value={effectiveId} onChange={setCaseId} />

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent ref={listRef} className="flex-1 space-y-4 overflow-y-auto scrollbar-thin p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-primary/15">
                <Bot className="size-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">Ask about the selected case</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                {(sugg?.suggestions ?? []).map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="rounded-full border border-border bg-background/50 px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <MessageBubble key={i} m={m} />)
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner /> Reasoning over computed results…
            </div>
          ) : null}
        </CardContent>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Sparkles className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={effectiveId ? "Ask about exit points, burners, recovery…" : "Select a case first"}
                value={input}
                disabled={!effectiveId}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
            <Button onClick={() => ask(input)} disabled={!effectiveId || !input.trim() || loading}>
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function MessageBubble({ m }: { m: Message }) {
  const isUser = m.role === "user"
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div className={`min-w-0 max-w-[80%] space-y-1.5 ${isUser ? "items-end" : ""}`}>
        <div
          className={`rounded-lg px-3 py-2 text-sm leading-relaxed text-pretty ${
            isUser ? "bg-primary text-primary-foreground" : "border border-border bg-background/40 text-foreground/90"
          }`}
        >
          {m.text}
        </div>
        {!isUser && (m.sources?.length || m.provenance) ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {m.sources?.map((s) => (
              <Badge key={s} variant="muted">
                {s}
              </Badge>
            ))}
            {m.provenance ? <span className="text-[10px] text-muted-foreground">{m.provenance}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
