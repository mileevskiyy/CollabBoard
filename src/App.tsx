import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type DragEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  Activity,
  Settings2,
  X,
  Check,
  CheckCircle2,
  MessageSquare,
  ArrowLeftRight,
  Calendar,
  Link2,
  Copy,
  Trash2,
  LockKeyhole,
  GripVertical,
  ChevronDown,
  RefreshCw,
  Layers,
  Flag,
  AlertTriangle,
  Eye,
  Wifi,
  Dot,
} from "lucide-react";
import type { Board, Card, Column, User, Role } from "../server/model";
type Snapshot = { me: User; role: Role; board: Omit<Board, "receipts"> };
const columnNames: Record<Column, string> = {
  backlog: "Backlog",
  doing: "In progress",
  review: "In review",
  done: "Done",
};
const columnIds: Column[] = ["backlog", "doing", "review", "done"];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => Array.from(s)[0] || "")
    .join("")
    .toUpperCase();
const day = (n: number) =>
  new Date(n).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const due = (v: string) =>
  new Date(v + "T12:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <i />
        <i />
        <i />
      </span>
      collab<span>board</span>
      <sup>●</sup>
    </span>
  );
}
function Modal({
  title,
  close,
  children,
  drawer = false,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  drawer?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={(drawer ? "drawer " : "") + (wide ? "wide" : "")}
      onCancel={close}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [w, setW] = useState<Snapshot | null>(null),
    [me, setMe] = useState<User | null>(null),
    [csrf, setCsrf] = useState(""),
    [boards, setBoards] = useState<any[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connection, setConnection] = useState("connecting"),
    [modal, setModal] = useState<any>(null),
    [draft, setDraft] = useState<any>(null),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [inviteMode, setInviteMode] = useState(
      new URLSearchParams(location.search).get("invite") || "",
    ),
    [invite, setInvite] = useState<any>(null),
    [invites, setInvites] = useState<any[]>([]),
    [inviteRole, setInviteRole] = useState("editor"),
    [dragging, setDragging] = useState<{ id: string; version: number } | null>(
      null,
    ),
    [dropColumn, setDropColumn] = useState<Column | null>(null);
  const pending = useRef(new Map<string, string>()),
    activeBoardId = useRef<string | null>(null),
    revision = useRef(-1),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function request(
    path: string,
    method = "GET",
    body?: any,
    token = csrf,
  ) {
    const response = await fetch("/api" + path, {
      method,
      headers: { "Content-Type": "application/json", "x-csrf-token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        activeBoardId.current = null;
        revision.current = -1;
        setW(null);
        setCsrf("");
        setMe(null);
      }
      const e = new Error(data.error || "Request failed.") as Error & {
        status?: number;
      };
      e.status = response.status;
      throw e;
    }
    return data;
  }
  function accept(data: Snapshot) {
    if (
      activeBoardId.current === data.board.id &&
      data.board.revision < revision.current
    )
      return;
    activeBoardId.current = data.board.id;
    revision.current = data.board.revision;
    setW(data);
    setMe(data.me);
  }
  async function load(boardId: string, token = csrf) {
    const data = await request("/boards/" + boardId, "GET", undefined, token);
    accept(data);
    history.replaceState({}, "", location.pathname + "?board=" + boardId);
    return data;
  }
  async function command(path: string, method: string, body: any) {
    const signature = JSON.stringify({ path, method, body });
    let key = pending.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      pending.current.set(signature, key);
    }
    try {
      const result = await request(path, method, { ...body, requestId: key });
      pending.current.delete(signature);
      if (result.board) accept(result);
      return result;
    } catch (e) {
      if ((e as any).status && (e as any).status < 500)
        pending.current.delete(signature);
      throw e;
    }
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        const s = await request("/session");
        if (s.authenticated) {
          setCsrf(s.csrf);
          setMe(s.me);
          setBoards(s.boards);
          if (!new URLSearchParams(location.search).get("invite")) {
            const wanted = new URLSearchParams(location.search).get("board");
            if (wanted || s.boards.length)
              await load(wanted || s.boards[0].id, s.csrf);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!w) return;
    const boardId = w.board.id;
    setConnection("connecting");
    let stopped = false;
    const source = new EventSource("/api/boards/" + boardId + "/live");
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        if (!stopped)
          void request("/boards/" + boardId)
            .then((data) => {
              if (!stopped && activeBoardId.current === boardId) accept(data);
            })
            .catch((e) => {
              if (!stopped) {
                setError(e.message);
                setConnection("reconnecting");
              }
            });
      }, 45);
    };
    const changed = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      setConnection("live");
      if (data.revision !== revision.current) refresh();
    };
    source.addEventListener("connected", changed as any);
    source.addEventListener("change", changed as any);
    source.addEventListener("resync", changed as any);
    source.addEventListener("revoked", () => {
      source.close();
      activeBoardId.current = null;
      revision.current = -1;
      setModal(null);
      setW(null);
      setError(
        "Your board access or this demo expired. Ask the owner for a new invitation.",
      );
      setConnection("revoked");
    });
    source.onerror = () => {
      if (!stopped) setConnection("reconnecting");
    };
    return () => {
      stopped = true;
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [w?.board.id, csrf]);
  useEffect(() => {
    if (w)
      void request("/boards")
        .then(setBoards)
        .catch(() => {});
  }, [w?.board.id]);
  useEffect(() => {
    if (modal?.kind === "team" && w?.role === "owner")
      void request(`/boards/${w.board.id}/invites`)
        .then(setInvites)
        .catch((e) => setError(e.message));
  }, [modal?.kind, w?.board.revision, w?.role]);
  useEffect(() => {
    if (
      modal?.kind === "card" &&
      draft?.id &&
      w &&
      !w.board.cards.some((c) => c.id === draft.id)
    ) {
      setModal(null);
      setNotice("That card was removed in another window.");
    }
  }, [w?.board.revision]);
  async function enter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(
      new FormData(e.currentTarget).get("name") || me?.name || "Demo owner",
    );
    await run(async () => {
      let token = csrf;
      if (!me || !token) {
        const s = await request("/session", "POST", { name });
        setCsrf(s.csrf);
        setMe(s.me);
        token = s.csrf;
      }
      const data = inviteMode
        ? await request("/join", "POST", { invite: inviteMode }, token)
        : await request("/boards", "POST", { title: "Website refresh" }, token);
      accept(data);
      setInviteMode("");
      history.replaceState(
        {},
        "",
        location.pathname + "?board=" + data.board.id,
      );
    });
  }
  function openCard(c?: Card) {
    setDraft(
      c
        ? structuredClone(c)
        : {
            title: "",
            description: "",
            priority: "normal",
            color: "paper",
            assigneeId: null,
            dueDate: null,
            tags: [],
          },
    );
    setModal({ kind: "card" });
  }
  async function saveCard(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await run(async () => {
      const fd = new FormData(e.currentTarget);
      const data = {
        title: String(fd.get("title")),
        description: String(fd.get("description")),
        priority: String(fd.get("priority")),
        color: String(fd.get("color")),
        assigneeId: String(fd.get("assignee") || "") || null,
        dueDate: String(fd.get("due") || "") || null,
        tags: String(fd.get("tags") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        ...(draft.id ? { version: draft.version } : {}),
      };
      await command(
        `/boards/${w!.board.id}/cards` + (draft.id ? "/" + draft.id : ""),
        draft.id ? "PUT" : "POST",
        data,
      );
      setModal(null);
      setNotice(
        draft.id
          ? "Changes shared with the board."
          : "Card added. Give the idea somewhere to go.",
      );
    });
  }
  async function move(
    card: { id: string; version: number },
    to: Column,
    beforeId: string | null = null,
  ) {
    await run(async () => {
      await command(`/boards/${w!.board.id}/cards/${card.id}/move`, "POST", {
        version: card.version,
        to,
        beforeId,
      });
      setModal(null);
      setNotice("Card moved. Everyone is on the same page.");
    });
    setDragging(null);
    setDropColumn(null);
  }
  function drop(e: DragEvent, to: Column, beforeId: string | null = null) {
    e.preventDefault();
    e.stopPropagation();
    let card = dragging;
    try {
      if (!card)
        card = JSON.parse(e.dataTransfer.getData("application/collab-card"));
    } catch {}
    if (card && card.id !== beforeId) void move(card, to, beforeId);
    else {
      setDragging(null);
      setDropColumn(null);
    }
  }
  async function copyInvite() {
    if (!invite?.url) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setNotice("Invitation link copied. Share it with one person.");
    } catch {
      setNotice("Select and copy the invitation link below.");
    }
  }
  if (!ready)
    return (
      <div className="loading">
        <Logo />
        <p>Finding a little shared headspace…</p>
      </div>
    );
  if (!w)
    return (
      <div className="landing">
        <header>
          <Logo />
          <span className="mono">GOOD WORK IS A TEAM SPORT.</span>
        </header>
        <main className="landing-grid">
          <div className="landing-copy">
            <span className="eyebrow">
              <i />
              LESS SCATTERED. MORE TOGETHER.
            </span>
            <h1>
              Big ideas.
              <br />
              Small steps.
              <br />
              <em>Shared space.</em>
            </h1>
            <p>
              A place for the work, the conversations and the people
              <br className="desktop" /> moving it forward. Keep the good stuff
              together.
            </p>
            <form onSubmit={enter}>
              <label>
                Your display name
                <input
                  name="name"
                  minLength={2}
                  maxLength={30}
                  required
                  defaultValue={me?.name || "Demo owner"}
                  readOnly={Boolean(me)}
                />
              </label>
              <button className="primary large" disabled={busy}>
                {busy
                  ? "Opening the board…"
                  : inviteMode
                    ? "Join the board"
                    : "Try the demo"}
                <ArrowUpRight size={19} />
              </button>
            </form>
            <div className="landing-fine">
              <span className="tiny-dot" />
              {inviteMode
                ? "A single-use invitation. Your role is chosen by the board owner."
                : "Your own board. Invite someone and try it together."}
            </div>
            {inviteMode && (
              <button
                className="text-button"
                onClick={() => {
                  setInviteMode("");
                  history.replaceState({}, "", location.pathname);
                  setError("");
                }}
              >
                Create my own demo instead
                <ArrowRight size={14} />
              </button>
            )}
            {me && boards.length > 0 && !inviteMode && (
              <button
                className="text-button"
                onClick={() =>
                  run(async () => {
                    await load(boards[0].id);
                  })
                }
              >
                Return to {boards[0].title}
                <ArrowRight size={14} />
              </button>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="landing-art" aria-hidden="true">
            <div className="art-label">
              <span>THE NEXT GOOD THING</span>
              <span>↗</span>
            </div>
            <div className="art-grid">
              <div className="art-col">
                <span>
                  TO THINK ABOUT <i>02</i>
                </span>
                <div className="art-card lavender">
                  <small>01 / BIG PICTURE</small>
                  <strong>
                    Make room
                    <br />
                    for a better idea.
                  </strong>
                  <div>
                    <span>research</span>
                    <b>↗</b>
                  </div>
                </div>
                <div className="art-card butter">
                  <small>02 / FIND YOUR WORDS</small>
                  <strong>
                    Say it
                    <br />
                    like a human.
                  </strong>
                  <div>
                    <span>content</span>
                    <b>↗</b>
                  </div>
                </div>
              </div>
              <div className="art-col">
                <span>
                  IN THE MAKING <i>01</i>
                </span>
                <div className="art-card mint">
                  <small>03 / LITTLE BY LITTLE</small>
                  <strong>
                    Turn the
                    <br />
                    “what if”
                    <br />
                    into a thing.
                  </strong>
                  <div>
                    <span>in progress</span>
                    <b>✳</b>
                  </div>
                </div>
                <div className="art-status">
                  <CheckCircle2 size={16} />A little momentum goes a long way.
                </div>
              </div>
            </div>
            <div className="cursor-label">
              <span>↖</span>YOU + YOUR PEOPLE
            </div>
          </div>
        </main>
        <div className="landing-bottom">
          <div>
            <Layers size={17} />
            <span>One board. A clearer picture.</span>
          </div>
          <div>
            <Users size={17} />
            <span>Editors, viewers, shared context.</span>
          </div>
          <div>
            <Wifi size={17} />
            <span>Changes arrive as they happen.</span>
          </div>
        </div>
        <footer>
          Disposable demo · Boards expire after 24 hours or a server restart ·
          Display names are not verified identities.
        </footer>
      </div>
    );
  const board = w.board,
    canEdit = w.role !== "viewer",
    isOwner = w.role === "owner",
    liveCard = draft?.id ? board.cards.find((c) => c.id === draft.id) : null;
  const filtered = board.cards.filter(
    (c) =>
      [c.title, c.description, ...c.tags, "CB-" + c.number]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "mine" && c.assigneeId === w.me.id) ||
        (filter === "unassigned" && c.assigneeId === null) ||
        (filter === "high" && c.priority === "high")),
  );
  const selectedCardComments = draft?.id
    ? board.comments.filter((c) => c.cardId === draft.id)
    : [];
  return (
    <div className="app">
      <header className="app-header">
        <button
          className="brand"
          onClick={() => setModal({ kind: "boards" })}
          aria-label="Your boards"
        >
          <Logo />
        </button>
        <div className="header-divider" />
        <button
          className="workspace-switch"
          onClick={() => setModal({ kind: "boards" })}
        >
          <span className="workspace-symbol">W</span>Workspace
          <ChevronDown size={12} />
        </button>
        <div className="header-right">
          <span className={"connection " + connection}>
            <i />
            {connection === "live"
              ? "Live updates"
              : connection === "connecting"
                ? "Connecting…"
                : "Reconnecting…"}
          </span>
          <span className="header-divider" />
          <span className="avatar you" title={w.me.name}>
            {initials(w.me.name)}
          </span>
        </div>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await load(board.id);
                  setError("");
                })
              }
            >
              Refresh board
            </button>
            <button
              className="icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <CheckCircle2 size={17} />
            {notice}
          </div>
        )}
        <div className="board-heading">
          <div>
            <div className="board-breadcrumb">
              <span className="breadcrumb-dot" />
              YOUR SHARED SPACE<span>/</span>BOARD 01
            </div>
            <h1>
              {board.title}
              <span className="title-spark">✳</span>
            </h1>
            <p>{board.description}</p>
          </div>
          <div className="board-heading-right">
            <div className="member-avatars">
              {board.members.slice(0, 4).map((m, i) => (
                <span key={m.id} className={"avatar a" + i} title={m.name}>
                  {initials(m.name)}
                </span>
              ))}
            </div>
            <button
              className="secondary"
              onClick={() => {
                setInvite(null);
                setModal({ kind: "team" });
              }}
            >
              <Users size={15} />
              {board.members.length} member
              {board.members.length === 1 ? "" : "s"}
            </button>
            {isOwner && (
              <button
                className="primary"
                onClick={() => {
                  setInvite(null);
                  setModal({ kind: "team" });
                }}
              >
                <Plus size={16} />
                Invite people
              </button>
            )}
          </div>
        </div>
        <div className="board-toolbar">
          <div className="board-tabs">
            <button className="selected">
              <Layers size={15} />
              Board<span>{board.cards.length}</span>
            </button>
            <button onClick={() => setModal({ kind: "activity" })}>
              <Activity size={15} />
              Activity
            </button>
            <button onClick={() => setModal({ kind: "team" })}>
              <Users size={15} />
              People
            </button>
          </div>
          <div className="board-controls">
            <label className="search">
              <Search size={14} />
              <input
                aria-label="Search cards"
                placeholder="Find a card…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label className="filter">
              <SlidersHorizontal size={14} />
              <select
                aria-label="Filter cards"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All cards</option>
                <option value="mine">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
                <option value="high">High priority</option>
              </select>
            </label>
            {isOwner && (
              <button
                className="icon"
                aria-label="Board settings"
                onClick={() =>
                  setModal({ kind: "settings", revision: board.revision })
                }
              >
                <Settings2 size={17} />
              </button>
            )}
          </div>
        </div>
        {!canEdit && (
          <div className="viewer-banner">
            <Eye size={15} />
            <span>
              You’re viewing this board. The owner can give you edit access.
            </span>
            <span className="mono">READ ONLY</span>
          </div>
        )}
        <div className="kanban-scroll">
          <div className="kanban">
            {columnIds.map((col) => {
              const all = board.cards.filter((c) => c.column === col),
                cards = filtered
                  .filter((c) => c.column === col)
                  .sort((a, b) => a.position - b.position),
                limit =
                  col === "doing" || col === "review" ? board.limits[col] : 0;
              return (
                <section
                  className={
                    "column " + (dropColumn === col ? "drop-active" : "")
                  }
                  key={col}
                  onDragOver={(e) => {
                    if (canEdit) {
                      e.preventDefault();
                      setDropColumn(col);
                    }
                  }}
                  onDrop={(e) => {
                    if (canEdit) drop(e, col);
                  }}
                  aria-label={columnNames[col]}
                >
                  <div className="column-heading">
                    <div>
                      <i className={"column-dot " + col} />
                      <h2>{columnNames[col]}</h2>
                      <span
                        className={
                          "column-count " +
                          (limit && all.length >= limit ? "at-limit" : "")
                        }
                      >
                        {all.length}
                        {limit ? "/" + limit : ""}
                      </span>
                    </div>
                    {col === "backlog" && canEdit && (
                      <button
                        className="icon"
                        aria-label="Add a card"
                        onClick={() => openCard()}
                      >
                        <Plus size={16} />
                      </button>
                    )}
                    {col === "done" && <CheckCircle2 size={15} />}
                  </div>
                  <div className="column-subtitle">
                    {col === "backlog"
                      ? "Good ideas start here."
                      : col === "doing"
                        ? "A little focus goes a long way."
                        : col === "review"
                          ? "A fresh pair of eyes."
                          : "Small wins, added up."}
                  </div>
                  <div className="column-cards">
                    {cards.map((c) => {
                      const assignee = board.members.find(
                          (m) => m.id === c.assigneeId,
                        ),
                        comments = board.comments.filter(
                          (x) => x.cardId === c.id,
                        ).length;
                      return (
                        <article
                          className={`task-card ${c.color} ${dragging?.id === c.id ? "dragging" : ""}`}
                          key={c.id}
                          draggable={canEdit && !busy}
                          onDragStart={(e) => {
                            const value = { id: c.id, version: c.version };
                            setDragging(value);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "application/collab-card",
                              JSON.stringify(value),
                            );
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropColumn(null);
                          }}
                          onDragOver={(e) => {
                            if (canEdit) e.preventDefault();
                          }}
                          onDrop={(e) => {
                            if (canEdit) drop(e, col, c.id);
                          }}
                          data-card-number={c.number}
                        >
                          <button
                            className="card-open"
                            onClick={() => openCard(c)}
                            aria-label={`Open CB-${c.number}: ${c.title}`}
                          >
                            <div className="card-topline">
                              <span>CB-{c.number}</span>
                              <span className={"priority " + c.priority}>
                                {c.priority === "high" ? (
                                  <Flag size={10} />
                                ) : c.priority === "low" ? (
                                  <span>↓</span>
                                ) : (
                                  <span>−</span>
                                )}
                                {c.priority}
                              </span>
                            </div>
                            <h3>{c.title}</h3>
                            <div className="card-tags">
                              {c.tags.map((t) => (
                                <span key={t}>{t}</span>
                              ))}
                            </div>
                            {c.dueDate && (
                              <div
                                className={
                                  "card-due " +
                                  (c.dueDate <
                                    new Date().toISOString().slice(0, 10) &&
                                  c.column !== "done"
                                    ? "overdue"
                                    : "")
                                }
                              >
                                <Calendar size={11} />
                                {due(c.dueDate)}
                              </div>
                            )}
                          </button>
                          <div className="card-footer">
                            <div>
                              {assignee ? (
                                <span
                                  className="card-avatar"
                                  title={assignee.name}
                                >
                                  {initials(assignee.name)}
                                </span>
                              ) : (
                                <span className="unassigned" title="Unassigned">
                                  <Users size={13} />
                                </span>
                              )}
                              <span className="comment-count">
                                <MessageSquare size={12} />
                                {comments}
                              </span>
                            </div>
                            {canEdit && (
                              <button
                                className="move-button"
                                onClick={() =>
                                  setModal({
                                    kind: "move",
                                    card: c,
                                    to: c.column,
                                  })
                                }
                                aria-label={`Move CB-${c.number}`}
                              >
                                <ArrowLeftRight size={13} />
                                <span>Move</span>
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {!cards.length && (
                      <div className="empty-column">
                        <span>
                          {query || filter !== "all"
                            ? "No matching cards"
                            : col === "done"
                              ? "The next small win goes here."
                              : "A little room for what’s next."}
                        </span>
                      </div>
                    )}
                    {col === "backlog" && canEdit && (
                      <button className="add-card" onClick={() => openCard()}>
                        <Plus size={15} />
                        Add a card<span>↗</span>
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        <footer className="board-footer">
          <span>
            <i />
            ONE BOARD. EVERYONE ON THE SAME PAGE.
          </span>
          <p>
            Demo board · Expires {day(board.expiresAt)} · UTC dates · Roles
            apply to anonymous demo identities.
          </p>
          <span className="revision">
            REV / {String(board.revision).padStart(3, "0")}
          </span>
        </footer>
      </main>
      {modal && (
        <Modal
          key={modal.kind + (modal.card?.id || "") + (modal.revision ?? "")}
          title={
            modal.kind === "card"
              ? draft.id
                ? "CB-" + draft.number
                : "Make room for an idea"
              : modal.kind === "team"
                ? "Your people"
                : modal.kind === "activity"
                  ? "A little momentum"
                  : modal.kind === "settings"
                    ? "Shape this space"
                    : modal.kind === "move"
                      ? "Move this card"
                      : modal.kind === "delete"
                        ? "Let this one go?"
                        : modal.kind === "new-board"
                          ? "A fresh shared space"
                          : "Your boards"
          }
          drawer={modal.kind === "team" || modal.kind === "activity"}
          wide={modal.kind === "card"}
          close={() => {
            if (!busy) {
              setModal(null);
              setError("");
            }
          }}
        >
          {modal.kind === "card" && (
            <>
              <div className="card-modal-status">
                <span className={"column-dot " + (draft.column || "backlog")} />
                <span>{columnNames[draft.column as Column] || "Backlog"}</span>
                {draft.id && <span>VERSION {draft.version}</span>}
              </div>
              {draft.id && liveCard && draft.version !== liveCard.version && (
                <div className="stale-card">
                  <AlertTriangle size={16} />
                  <span>
                    This card changed in another window. Loading the latest
                    version will replace your draft.
                  </span>
                  <button onClick={() => setDraft(structuredClone(liveCard))}>
                    Load latest
                  </button>
                </div>
              )}
              <form onSubmit={saveCard}>
                <label>
                  Card title
                  <input
                    name="title"
                    required
                    maxLength={120}
                    defaultValue={draft.title}
                    key={"title" + draft.version}
                    disabled={!canEdit}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    name="description"
                    rows={5}
                    maxLength={4000}
                    defaultValue={draft.description}
                    key={"desc" + draft.version}
                    disabled={!canEdit}
                    placeholder="A little context makes a big difference…"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    Assigned to
                    <select
                      name="assignee"
                      defaultValue={draft.assigneeId || ""}
                      key={"assign" + draft.version}
                      disabled={!canEdit}
                    >
                      <option value="">Unassigned</option>
                      {board.members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Due date (UTC)
                    <input
                      name="due"
                      type="date"
                      defaultValue={draft.dueDate || ""}
                      key={"due" + draft.version}
                      disabled={!canEdit}
                    />
                  </label>
                  <label>
                    Priority
                    <select
                      name="priority"
                      defaultValue={draft.priority}
                      key={"priority" + draft.version}
                      disabled={!canEdit}
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label>
                    Tags <small>(comma separated, up to 5)</small>
                    <input
                      name="tags"
                      maxLength={105}
                      defaultValue={draft.tags.join(", ")}
                      key={"tags" + draft.version}
                      disabled={!canEdit}
                    />
                  </label>
                </div>
                <fieldset className="card-colors" disabled={!canEdit}>
                  <legend>Card colour</legend>
                  {["paper", "lavender", "mint", "peach", "butter"].map((c) => (
                    <label key={c} className={c}>
                      <input
                        type="radio"
                        name="color"
                        value={c}
                        defaultChecked={draft.color === c}
                        key={c + draft.version}
                      />
                      <span>{c}</span>
                    </label>
                  ))}
                </fieldset>
                {canEdit && (
                  <div className="form-actions">
                    {draft.id && (
                      <button
                        className="danger-text"
                        type="button"
                        onClick={() =>
                          setModal({ kind: "delete", card: draft })
                        }
                      >
                        <Trash2 size={14} />
                        Delete card
                      </button>
                    )}
                    <button type="submit" className="primary" disabled={busy}>
                      {busy
                        ? "Saving…"
                        : draft.id
                          ? "Save changes"
                          : "Create card"}
                      <Check size={16} />
                    </button>
                  </div>
                )}
              </form>
              {draft.id && (
                <section className="conversation">
                  <div className="conversation-heading">
                    <MessageSquare size={17} />
                    <h3>Conversation</h3>
                    <span>{selectedCardComments.length}</span>
                  </div>
                  {selectedCardComments.length === 0 && (
                    <p className="conversation-empty">
                      Leave a question, a decision or a little useful context.
                    </p>
                  )}
                  {selectedCardComments.map((c) => (
                    <article className="comment" key={c.id}>
                      <span className="avatar">{initials(c.authorName)}</span>
                      <div>
                        <div className="comment-meta">
                          <strong>{c.authorName}</strong>
                          <span>
                            {new Date(c.createdAt).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "UTC",
                            })}{" "}
                            UTC
                          </span>
                          {canEdit && (isOwner || c.authorId === w.me.id) && (
                            <button
                              className="icon"
                              aria-label={`Delete comment by ${c.authorName}`}
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await command(
                                    `/boards/${board.id}/comments/${c.id}`,
                                    "DELETE",
                                    {},
                                  );
                                })
                              }
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                        <p>{c.body}</p>
                      </div>
                    </article>
                  ))}
                  {canEdit ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          body = String(new FormData(form).get("comment"));
                        void run(async () => {
                          await command(
                            `/boards/${board.id}/cards/${draft.id}/comments`,
                            "POST",
                            { body },
                          );
                          form.reset();
                          setNotice("Comment shared.");
                        });
                      }}
                    >
                      <label>
                        Add a comment
                        <textarea
                          name="comment"
                          rows={3}
                          maxLength={1000}
                          required
                          placeholder="What would help move this forward?"
                        />
                      </label>
                      <button className="secondary" disabled={busy}>
                        Post comment
                        <ArrowUpRight size={14} />
                      </button>
                    </form>
                  ) : (
                    <p className="read-only-note">
                      <Eye size={14} />
                      Viewers can read the conversation.
                    </p>
                  )}
                </section>
              )}
            </>
          )}
          {modal.kind === "move" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const to = String(
                  new FormData(e.currentTarget).get("column"),
                ) as Column;
                void move(modal.card, to);
              }}
            >
              <span className="eyebrow">CB-{modal.card.number}</span>
              <h3 className="move-title">{modal.card.title}</h3>
              <label>
                Move to
                <select name="column" defaultValue={modal.to}>
                  {columnIds.map((c) => (
                    <option key={c} value={c}>
                      {columnNames[c]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-hint">
                The card will move to the bottom of that column.
                Work-in-progress limits still apply.
              </p>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  Move card
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          )}
          {modal.kind === "team" && (
            <>
              <p className="drawer-intro">
                A shared board works better with shared context. Everyone here
                is using an anonymous demo identity.
              </p>
              <div className="team-list">
                {board.members.map((m, i) => (
                  <article key={m.id}>
                    <span className={"avatar a" + (i % 4)}>
                      {initials(m.name)}
                    </span>
                    <div>
                      <strong>
                        {m.name}
                        {m.id === w.me.id && <small> (you)</small>}
                      </strong>
                      <span>
                        {m.role === "owner"
                          ? "Board owner"
                          : m.role === "editor"
                            ? "Can edit cards and comment"
                            : "Can view the board"}
                      </span>
                    </div>
                    {isOwner && m.role !== "owner" ? (
                      <select
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => {
                          const role = e.target.value;
                          void run(async () => {
                            await command(
                              `/boards/${board.id}/members/${m.id}`,
                              "PATCH",
                              { role, revision: board.revision },
                            );
                          });
                        }}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="remove">Remove</option>
                      </select>
                    ) : (
                      <span className="role-badge">{m.role}</span>
                    )}
                  </article>
                ))}
              </div>
              {isOwner ? (
                <section className="invite-section">
                  <span className="eyebrow">A LITTLE MORE TOGETHER</span>
                  <h3>Invite someone in.</h3>
                  <p>
                    One person per link. Expires after one hour, or when this
                    board expires.
                  </p>
                  <div className="invite-controls">
                    <select
                      aria-label="Invitation role"
                      value={inviteRole}
                      onChange={(e) => {
                        setInviteRole(e.target.value);
                        setInvite(null);
                      }}
                    >
                      <option value="editor">
                        Editor · can edit & comment
                      </option>
                      <option value="viewer">Viewer · read only</option>
                    </select>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          setInvite(null);
                          const r = await command(
                            `/boards/${board.id}/invites`,
                            "POST",
                            { role: inviteRole, revision: board.revision },
                          );
                          if (!r.result?.token)
                            throw new Error(
                              "The invite was created, but its secret is shown only once. Revoke it below and create another link.",
                            );
                          setInvite({
                            ...r.result,
                            url: location.origin + "/?invite=" + r.result.token,
                          });
                        })
                      }
                    >
                      <Link2 size={14} />
                      Create link
                    </button>
                  </div>
                  {invite && (
                    <div className="share-link">
                      <label>
                        Single-use invitation link
                        <input
                          aria-label="Single-use invitation link"
                          readOnly
                          value={invite.url}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={invites.some(
                          (i) => i.id === invite.id && i.usedBy,
                        )}
                        onClick={copyInvite}
                      >
                        <Copy size={14} />
                        Copy link
                      </button>
                      <small>
                        {invites.some((i) => i.id === invite.id && i.usedBy)
                          ? "Already used. Create a fresh link for another person."
                          : invite.role + " access"}{" "}
                        · expires{" "}
                        {new Date(invite.expires).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · share with one person.
                      </small>
                    </div>
                  )}
                  {invites.filter((i) => !i.usedBy).length > 0 && (
                    <div className="pending-invites">
                      <h4>Unused invitations</h4>
                      {invites
                        .filter((i) => !i.usedBy)
                        .map((i) => (
                          <div key={i.id}>
                            <span>{i.role} access</span>
                            <small>
                              expires in{" "}
                              {Math.max(
                                1,
                                Math.ceil((i.expires - Date.now()) / 60000),
                              )}
                              m
                            </small>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                run(async () => {
                                  await command(
                                    `/boards/${board.id}/invites/${i.id}`,
                                    "DELETE",
                                    {},
                                  );
                                  if (invite?.id === i.id) setInvite(null);
                                })
                              }
                            >
                              Revoke
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              ) : (
                <div className="role-explainer">
                  <LockKeyhole size={18} />
                  <p>
                    Only the owner can invite people, change roles and edit
                    board settings.
                  </p>
                </div>
              )}
            </>
          )}
          {modal.kind === "activity" && (
            <>
              <p className="drawer-intro">
                The latest 200 real changes on this board. Sample cards start
                with an empty activity history.
              </p>
              <div className="activity-list">
                {[...board.events].reverse().map((e) => (
                  <article key={e.id}>
                    <span className="activity-dot" />
                    <div>
                      <p>
                        <strong>{e.actorName}</strong> {e.text}
                      </p>
                      <span>
                        {new Date(e.at).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "UTC",
                        })}{" "}
                        UTC · #{e.id}
                      </span>
                    </div>
                  </article>
                ))}
                {!board.events.length && (
                  <div className="empty-activity">
                    <Activity size={30} />
                    <h3>Your next move starts the story.</h3>
                    <p>Add a card, share a comment or invite a collaborator.</p>
                  </div>
                )}
              </div>
            </>
          )}
          {modal.kind === "settings" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                void run(async () => {
                  await command("/boards/" + board.id, "PUT", {
                    title: String(fd.get("title")),
                    description: String(fd.get("description")),
                    limits: {
                      doing: Number(fd.get("doing")),
                      review: Number(fd.get("review")),
                    },
                    revision: modal.revision,
                  });
                  setModal(null);
                  setNotice("Board settings updated.");
                });
              }}
            >
              <label>
                Board name
                <input
                  name="title"
                  minLength={2}
                  maxLength={70}
                  required
                  defaultValue={board.title}
                />
              </label>
              <label>
                A little context
                <textarea
                  name="description"
                  rows={3}
                  maxLength={250}
                  defaultValue={board.description}
                />
              </label>
              <h3 className="settings-subtitle">
                Less in flight. More moving forward.
              </h3>
              <p className="form-hint">
                Set work-in-progress limits for the middle columns. Use 0 for no
                limit. Move cards out before setting a limit below the current
                count.
              </p>
              <div className="form-grid">
                <label>
                  In progress limit
                  <input
                    name="doing"
                    type="number"
                    min={0}
                    max={20}
                    required
                    defaultValue={board.limits.doing}
                  />
                </label>
                <label>
                  In review limit
                  <input
                    name="review"
                    type="number"
                    min={0}
                    max={20}
                    required
                    defaultValue={board.limits.review}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  Save board settings
                  <Check size={15} />
                </button>
              </div>
            </form>
          )}
          {modal.kind === "delete" && (
            <>
              <p className="form-hint">
                Remove CB-{modal.card.number} and its comments? The activity
                history will keep a record of the removal.
              </p>
              <div className="form-actions">
                <button className="secondary" onClick={() => setModal(null)}>
                  Keep card
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await command(
                        `/boards/${board.id}/cards/${modal.card.id}`,
                        "DELETE",
                        { version: modal.card.version },
                      );
                      setModal(null);
                      setNotice("Card removed.");
                    })
                  }
                >
                  Delete card
                  <Trash2 size={14} />
                </button>
              </div>
            </>
          )}
          {modal.kind === "boards" && (
            <>
              <p className="form-hint">
                Your current demo identity can access these boards.
              </p>
              <div className="boards-list">
                {boards.map((b) => (
                  <button
                    key={b.id}
                    onClick={() =>
                      run(async () => {
                        await load(b.id);
                        setModal(null);
                        setQuery("");
                        setFilter("all");
                      })
                    }
                  >
                    <span>
                      <Layers size={17} />
                      {b.id === board.id ? board.title : b.title}
                    </span>
                    <small>{b.role}</small>
                    {b.id === board.id ? (
                      <Check size={16} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}
                  </button>
                ))}
              </div>
              <button
                className="primary"
                disabled={boards.length >= 8}
                onClick={() => setModal({ kind: "new-board" })}
              >
                <Plus size={16} />
                New demo board
              </button>
              <p className="form-hint">
                Boards expire 24 hours after creation and reset when the demo
                server restarts. Keep this browser session to retain access.
              </p>
            </>
          )}
          {modal.kind === "new-board" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = String(
                  new FormData(e.currentTarget).get("title"),
                );
                void run(async () => {
                  const r = await request("/boards", "POST", { title });
                  accept(r);
                  history.replaceState(
                    {},
                    "",
                    location.pathname + "?board=" + r.board.id,
                  );
                  setModal(null);
                  setQuery("");
                  setFilter("all");
                });
              }}
            >
              <label>
                Board name
                <input
                  name="title"
                  minLength={2}
                  maxLength={70}
                  required
                  placeholder="The next good thing"
                />
              </label>
              <p className="form-hint">
                Starts with a fresh copy of the sample project. Only you have
                access until you invite someone.
              </p>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  Create board
                  <ArrowRight size={15} />
                </button>
              </div>
            </form>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
