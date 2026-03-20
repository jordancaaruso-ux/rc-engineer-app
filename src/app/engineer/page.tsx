export default function EngineerChatPage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Engineer Chat</h1>
          <p className="page-subtitle">
            Describe the handling and iterate with your AI race engineer.
          </p>
        </div>
      </header>
      <section className="page-body flex flex-col h-full">
        <div className="flex-1 rounded-lg border border-border bg-secondary/30 p-4 mb-3 flex flex-col gap-3 text-sm">
          <div className="text-xs font-mono text-muted-foreground">
            Conversation
          </div>
          <div className="rounded-md border border-border/60 bg-black/40 p-3 text-xs text-muted-foreground">
            Engineer:
            <br />
            <span className="text-foreground">
              “Tell me what the car is doing in entry, mid, and exit. I’ll
              translate that into setup options.”
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-secondary/40 p-3 flex items-center gap-2">
          <input
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            placeholder="Describe the run, corner phases, and what you want to improve..."
          />
          <button className="inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-foreground hover:brightness-110 transition">
            Send
          </button>
        </div>
      </section>
    </>
  );
}

