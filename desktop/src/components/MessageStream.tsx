import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronRight, CirclePause, CircleHelp, FileText, ImageOff, Layers, Loader2, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import type { Agent } from '../lib/api';
import type { Item, Row, TextItem, ToolItem, WorkGroup, QuestionAnswerRow } from '../lib/items';
import { completedReplyIds, visibleWorkItems, workGroupDefaultOpen } from '../lib/items';
import { buildMessageRows } from '../lib/fileChanges';
import { describeTool, formatDuration } from '../lib/tools';
import { ZoomableImage } from './ImageLightbox';
import { TaskFileContext } from './Markdown';
import { AssistantReply } from './AssistantReply';
import { ReplyError } from './ReplyError';
import { QuestionAnswer } from './QuestionAnswer';
import { JumpToBottomChip } from './JumpToBottomChip';
import { useJumpToBottomVisibility } from '../lib/useJumpToBottomVisibility';
import { FileChangeSummary } from './FileChangeSummary';
import { countAddedMessages, followTailAfterScroll } from '../lib/streamScroll';
import { EditableUserMessage } from './UserMessageEdit';

const ESTIMATED_ROW_PX = 40;
const ACTIVITY_ROW =
  'group flex w-full items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-14 leading-5 text-left outline-none select-none cursor-pointer transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] hover:bg-[var(--msg-code-inline-bg)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none';
const WORK_ICON_SLOT = 'inline-flex h-5 w-4 shrink-0 items-center justify-center';
const CHEVRON_SLOT =
  'ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[8px] text-[var(--msg-tool-card-chevron)] transition-colors duration-[var(--motion-fast)] group-hover:bg-[var(--cmd-palette-item-hover)]';

type Toggle = (id: string, defaultOpen?: boolean) => void;

interface MessageStreamProps {
  taskId: string;
  agent: Agent;
  items: Item[];
  isRunning: boolean;
  /** The prompt that can be edited and sent again, if any. */
  editableId: string | null;
  onEditLast: (id: string, text: string) => Promise<void>;
  sendWithCmdEnter: boolean;
  /** A resumed task's native history is ready before its live tail is mounted. */
  isLoading: boolean;
  cwd: string | null;
  /** Includes the composer's gradient, status, queue, input and footer. */
  bottomPadding: number;
}

const expandedMemory = new Map<string, Map<string, boolean>>();

export default function MessageStream(props: MessageStreamProps) {
  if (props.isLoading) return null;
  return <ReadyMessageStream key={props.taskId} {...props} />;
}

function ReadyMessageStream({ taskId, agent, items, isRunning, editableId, onEditLast, sendWithCmdEnter, cwd, bottomPadding }: MessageStreamProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const previousTop = useRef(0);
  const jumping = useRef(false);
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(0);
  const displayedUnread = useRef(0);
  if (unread > 0) displayedUnread.current = unread;
  const previousMessages = useRef(items);
  const jump = useJumpToBottomVisibility();
  useEffect(() => {
    const before = previousMessages.current;
    previousMessages.current = items;
    if (followBottom.current) { setUnread(0); return; }
    const added = countAddedMessages(before, items);
    if (added) setUnread((count) => count + added);
  }, [items]);
  const rows = useMemo(() => buildMessageRows(items, isRunning, cwd), [items, isRunning, cwd]);
  const copyableReplies = useMemo(() => completedReplyIds(items, isRunning), [items, isRunning]);
  // Explicit open and closed choices survive virtualized rows; absent entries use their default.
  const [expanded, setExpanded] = useState(() => expandedMemory.get(taskId) ?? new Map<string, boolean>());
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index].id,
    overscan: 8,
    // Start with the tail window while real row heights and the viewport are measured.
    initialOffset: () => rows.length * ESTIMATED_ROW_PX + bottomPadding,
    paddingEnd: bottomPadding,
    scrollPaddingEnd: bottomPadding,
  });
  const totalSize = virtualizer.getTotalSize();
  const virtualRows = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    if (followBottom.current && rows.length > 0) {
      virtualizer.scrollToEnd({ behavior: jumping.current ? 'smooth' : 'auto' });
      previousTop.current = scroller.current?.scrollTop ?? 0;
    }
  }, [rows, totalSize, bottomPadding, virtualizer]);

  const toggle = useCallback((id: string, defaultOpen = false) => {
    setExpanded((current) => {
      const next = new Map(current);
      next.set(id, !(current.get(id) ?? defaultOpen));
      expandedMemory.set(taskId, next);
      return next;
    });
  }, [taskId]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-14 text-[var(--text-secondary)]">
        {t('empty')}
      </div>
    );
  }

  return (
    <TaskFileContext.Provider value={{ agent, id: taskId, cwd }}>
    <div className="relative h-full min-h-0">
    <div
      ref={scroller}
      className="message-scroll h-full overflow-y-auto"
      onWheel={(event) => {
        const element = event.currentTarget;
        if (event.ctrlKey || event.deltaY >= 0 || element.scrollHeight <= element.clientHeight) return;
        followBottom.current = false;
        jumping.current = false;
        setAway(true);
        jump.clear();
        virtualizer.cancelScroll();
      }}
      onScroll={(event) => {
        const element = event.currentTarget;
        const next = followTailAfterScroll(followBottom.current, previousTop.current, element);
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        if (!jumping.current) jump.onScroll(element.scrollTop - previousTop.current, nearBottom);
        if (nearBottom) { jumping.current = false; setUnread(0); }
        if (followBottom.current && !next) { jumping.current = false; virtualizer.cancelScroll(); }
        followBottom.current = next;
        setAway(!next);
        previousTop.current = element.scrollTop;
      }}
    >
      {/* Mounted rows stay in flow while asynchronous measurements catch up with growing content. */}
      <div className="w-full" style={{ paddingTop: virtualRows[0]?.start ?? 0, paddingBottom: Math.max(0, totalSize - (virtualRows.at(-1)?.end ?? 0)) }}>
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="w-full"
            >
              <div
                className={`message-column ${
                  row.type === 'user' ? 'pb-2 pt-5' : 'py-1'
                }`}
              >
                {row.type === 'reply' ? (
                  <AssistantReply text={row.text} at={row.at} copyable={copyableReplies.has(row.id)}>
                    <FileChangeSummary summary={row.changes} cwd={cwd} expanded={expanded.get(row.changes.id) ?? false} onToggle={() => toggle(row.changes.id)} />
                  </AssistantReply>
                ) : row.type === 'questionAnswer' ? (
                  <QuestionAnswer pairs={row.pairs} />
                ) : row.type === 'changes' ? (
                  <FileChangeSummary summary={row} cwd={cwd} expanded={expanded.get(row.id) ?? false} onToggle={() => toggle(row.id)} />
                ) : row.type === 'group' ? (
                  <Group group={row} expanded={expanded} onToggle={toggle} />
                ) : row.type === 'user' && row.id === editableId ? (
                  <EditableUserMessage text={row.text} sendWithCmdEnter={sendWithCmdEnter} onSend={(text) => onEditLast(row.id, text)}>
                    <ItemRow item={row} expanded={expanded} onToggle={toggle} />
                  </EditableUserMessage>
                ) : (
                  <ItemRow item={row} expanded={expanded} onToggle={toggle} copyable={copyableReplies.has(row.id)} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    <JumpToBottomChip visible={away && (jump.visible || unread > 0)} unread={away && unread === 0 ? 0 : displayedUnread.current} bottomOffset={bottomPadding + 12} onClick={() => {
      followBottom.current = true; jumping.current = true; setAway(false); setUnread(0); jump.clear();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      virtualizer.scrollToEnd({ behavior: reduced ? 'auto' : 'smooth' });
    }} />
    </div>
    </TaskFileContext.Provider>
  );
}

interface RowProps {
  expanded: Map<string, boolean>;
  onToggle: Toggle;
  /** False for work restored without a final reply; missing tool results stay static. */
  active?: boolean;
}

function ItemRow({ item, expanded, onToggle, copyable = false, active = true }: RowProps & { item: Item | QuestionAnswerRow; copyable?: boolean }) {
  switch (item.type) {
    case 'questionAnswer':
      return <QuestionAnswer pairs={item.pairs} />;
    case 'user':
      return (
        <div className="flex flex-col items-end gap-2">
          {item.images?.length || item.imageErrors?.length || item.files?.length ? (
            <div className="flex max-w-[488px] flex-wrap justify-end gap-2">
              {item.images?.map((src, index) => (
                <ZoomableImage key={index} src={src} className="max-h-[160px] max-w-[240px] rounded-lg border border-[var(--msg-user-border)] object-contain" />
              ))}
              {item.imageErrors?.map((reason, index) => (
                <span key={`image-error-${index}`} role="img" aria-label={t(reason === 'missing' ? 'imageMissing' : 'imageUnreadable')}
                  data-tooltip={t(reason === 'tooLarge' ? 'imageTooLarge' : reason === 'unsupported' ? 'imageUnsupported' : reason === 'missing' ? 'imageMissing' : 'imageUnreadable')}
                  className="flex min-h-[140px] max-w-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))] p-4 text-12 font-medium text-[hsl(var(--muted-foreground))]">
                  <ImageOff size={32} aria-hidden className="text-[var(--text-tertiary)]" /><span>{t(reason === 'missing' ? 'imageMissing' : 'imageUnreadable')}</span>
                </span>
              ))}
              {item.files?.map((file) => (
                <span
                  key={file.path ?? file.name}
                  data-tooltip={file.path}
                  className="inline-flex h-[30px] min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[var(--msg-user-border)] bg-[var(--msg-user-bg)] px-2.5 text-13 text-[var(--msg-user-text)]"
                >
                  <FileText size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  <span className="truncate">{file.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {item.text ? (
            <div className="selectable relative min-w-0 max-w-[488px] whitespace-pre-wrap rounded-xl border border-[var(--msg-user-border)] bg-[var(--msg-user-bg)] px-4 py-3 text-15 font-normal leading-[1.6] text-[var(--msg-user-text)] [overflow-wrap:anywhere]">
              {item.text}
            </div>
          ) : null}
        </div>
      );
    case 'error':
      return <ReplyError details={item.text} />;
    case 'assistant':
      return <AssistantReply text={item.text} copyable={copyable} at={item.at} />;
    case 'notice':
      return (
        <div className="flex items-center gap-1.5 px-2 py-[3px] text-14 text-[var(--status-paused)]">
          <span aria-hidden className="inline-flex h-[18px] w-4 shrink-0 items-center justify-center">
            <CirclePause size={13} />
          </span>
          {t('interrupted')}
        </div>
      );
    case 'compaction':
      return (
        <div role="separator" aria-label={t('compacted')} className="flex w-full select-none items-center gap-3 py-2">
          <div className="h-px flex-1 bg-[var(--msg-tool-card-border)]" />
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--msg-tool-card-border)] px-2.5 py-1 text-12 text-[var(--msg-tool-card-chevron)]">
            <Layers size={12} aria-hidden className="shrink-0" />
            {t('compacted')}
          </div>
          <div className="h-px flex-1 bg-[var(--msg-tool-card-border)]" />
        </div>
      );
    case 'thinking':
      return <ThinkingRow item={item} isOpen={expanded.get(item.id) ?? false} onToggle={onToggle} />;
    case 'tool':
      return <ToolRow item={item} isOpen={expanded.get(item.id) ?? false} onToggle={onToggle} active={active} />;
  }
}

function workGroupLabel(group: WorkGroup): string {
  if (group.isRunning) return t('workRunning');
  if (group.durationMs === null) return t('workDetails');
  const key = group.hasFinalReply === false ? 'workRecorded' : group.isSummary ? 'processed' : 'worked';
  return t(key, { duration: formatDuration(group.durationMs) });
}

export function Group({ group, expanded, onToggle, active = true }: RowProps & { group: WorkGroup }) {
  const choice = expanded.get(group.id);
  const defaultOpen = workGroupDefaultOpen(group);
  const isOpen = choice ?? defaultOpen;
  const visible = visibleWorkItems(group, choice);
  const base = workGroupLabel(group);
  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        data-work-group={group.isRunning ? 'running' : 'completed'}
        onClick={() => onToggle(group.id, defaultOpen)}
        className="flex w-full cursor-pointer select-none items-center gap-1.5 rounded-[8px] py-[2px] text-14 leading-5 text-left transition-opacity duration-[var(--motion-fast)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <span aria-hidden className={`${WORK_ICON_SLOT} text-[var(--msg-tool-card-chevron)]`}>{group.isRunning ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" /> : <Layers size={14} />}</span>
        <span className="min-w-0 truncate text-14 leading-5 text-[var(--msg-tool-card-chevron)]">
          {base}
        </span>
        <div className="flex-1" />
        <ChevronRight
          size={14}
          aria-hidden
          className={`shrink-0 text-[var(--msg-tool-card-chevron)] transition-transform duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
      </button>
      {visible.length ? (
        <div className="mt-1 flex min-w-0 flex-col gap-0.5 border-l-2 border-[var(--agent-actions-rail)] py-[2px] pl-3">
          <WorkChildren rows={visible} expanded={expanded} onToggle={onToggle} active={active && group.hasFinalReply !== false} />
        </div>
      ) : null}
    </div>
  );
}

function WorkChildren({ rows, expanded, onToggle, active }: RowProps & { rows: Row[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > 80;
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => 36, enabled: virtualized, overscan: 5, getItemKey: (index) => rows[index].id });
  const render = (row: Row) => row.type === 'group'
    ? <Group key={row.id} group={row} expanded={expanded} onToggle={onToggle} active={active} />
    : <ItemRow key={row.id} item={row} expanded={expanded} onToggle={onToggle} active={active} />;
  if (!virtualized) return <>{rows.map(render)}</>;
  const mounted = virtual.getVirtualItems();
  return <div ref={scroller} className="h-[420px] overflow-y-auto overscroll-contain">
    <div className="w-full" style={{ paddingTop: mounted[0]?.start ?? 0, paddingBottom: Math.max(0, virtual.getTotalSize() - (mounted.at(-1)?.end ?? 0)) }}>
      {mounted.map((row) => <div key={row.key} data-index={row.index} ref={virtual.measureElement} className="w-full">{render(rows[row.index])}</div>)}
    </div>
  </div>;
}

function ThinkingRow({ item, isOpen, onToggle }: { item: TextItem; isOpen: boolean; onToggle: Toggle }) {
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-label={t('thinking')}
      onClick={() => onToggle(item.id)}
      className={`${ACTIVITY_ROW} ${isOpen ? '!items-start' : ''}`}
    >
      <span aria-hidden className={`${WORK_ICON_SLOT} text-[var(--msg-tool-card-chevron)]`}>
        <Sparkles size={13} />
      </span>
      <span
        className={`min-w-0 flex-1 text-14 italic text-[var(--thinking-body-text)] ${
          isOpen ? 'selectable whitespace-pre-wrap break-words' : 'truncate'
        }`}
      >
        {isOpen ? item.text : item.text.replace(/\s+/g, ' ')}
      </span>
      <span aria-hidden className={CHEVRON_SLOT}>
        <ChevronRight size={13} className={`transition-transform duration-[var(--motion-fast)] ${isOpen ? 'rotate-90' : ''}`} />
      </span>
    </button>
  );
}

function ToolRow({ item, isOpen, onToggle, active }: { item: ToolItem; isOpen: boolean; onToggle: Toggle; active: boolean }) {
  const display = useMemo(() => describeTool(item), [item]);
  const isDone = item.result !== null;
  const status = !isDone ? t(active ? 'running' : 'toolNoResult') : item.isError ? t('failed') : t('done');
  return (
    <div className="w-full min-w-0">
      <button type="button" aria-expanded={isOpen} onClick={() => onToggle(item.id)} className={ACTIVITY_ROW}>
        <span
          role="img"
          aria-label={status}
          className={`${WORK_ICON_SLOT} ${item.isError ? 'text-[var(--text-danger)]' : 'text-[var(--msg-tool-card-chevron)]'}`}
        >
          {!isDone && !active ? <CircleHelp size={13} /> : !isDone ? (
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
          ) : item.isError ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        {display.verb ? (
          <span className="shrink-0 text-14 text-[var(--msg-tool-card-chevron)]">{display.verb}</span>
        ) : null}
        {display.fileName ? (
          <span
            data-tooltip={display.text}
            className="inline-flex h-[22px] min-w-0 items-center gap-1 rounded-md border border-[var(--chat-input-chip-border)] bg-[var(--chat-input-chip-bg)] px-1.5 text-13 text-[var(--chat-input-chip-text)]"
          >
            <FileText size={12} aria-hidden className="shrink-0 text-[var(--chat-input-chip-icon)]" />
            <span className="min-w-0 truncate">{display.fileName}</span>
          </span>
        ) : (
          <span data-tooltip={display.title ?? display.text} className="min-w-0 truncate text-14 font-medium text-[var(--msg-tool-card-chevron)]">
            {display.text}
          </span>
        )}
        <span className="flex-1" />
        {display.stats ? (
          <span className="flex shrink-0 gap-1 font-mono text-13 font-medium">
            <span className="text-[var(--diff-add-fg)]">+{display.stats.added}</span>
            <span className="text-[var(--diff-del-fg)]">-{display.stats.removed}</span>
          </span>
        ) : null}
        <span aria-hidden className={CHEVRON_SLOT}>
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {display.command && !isOpen ? (
        <div
          data-tooltip={display.command}
          className="min-w-0 truncate px-2 pb-[3px] pl-[30px] font-mono text-12 leading-[1.5] text-[var(--msg-tool-card-chevron)]"
        >
          {display.command}
        </div>
      ) : null}
      {isOpen ? (
        <div className="mb-1 ml-[30px] mt-1 rounded-[8px] border border-[var(--msg-tool-card-border)] bg-[var(--msg-tool-card-bg)] px-3.5 py-2.5">
          <ToolText label={t('input')} text={item.input} />
          {item.result !== null ? <ToolText label={t('output')} text={item.result} /> : null}
          {item.truncated ? (
            <p className="mt-2 text-12 text-[var(--text-tertiary)]">{t('truncated')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolText({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium text-[var(--msg-tool-card-chevron)]">{label}</div>
      <pre className="selectable max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-normal text-[var(--msg-tool-text)]">
        {text}
      </pre>
    </div>
  );
}
