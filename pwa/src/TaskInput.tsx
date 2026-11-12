import type { ComponentProps, ReactNode } from 'react';
import { Composer } from './Composer';
import { Prompt } from './Prompt';
import type { Decision, PendingRequest } from './lib/types';

/** Waiting cards sit above the same mounted input, so its draft, caret and stop action survive. */
export function TaskInput({
  pending,
  answeringDisabled,
  onAnswer,
  composer,
  children,
}: {
  pending: PendingRequest[];
  answeringDisabled: boolean;
  onAnswer: (request: PendingRequest, decision: Decision) => Promise<void>;
  composer: ComponentProps<typeof Composer>;
  children?: ReactNode;
}) {
  return (
    <div className="task-input-stack">
      <div className="pending-requests">
        {pending.map((request) => (
          <Prompt
            key={request.requestId}
            request={request}
            disabled={answeringDisabled}
            onAnswer={(decision) => onAnswer(request, decision)}
          />
        ))}
      </div>
      <Composer {...composer}>{children}</Composer>
    </div>
  );
}
