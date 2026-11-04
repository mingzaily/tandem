import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { openExternal } from '../lib/api';
import '../styles/markdown.css';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeHighlight, { detect: false }]] as const;

const components: Components = {
  // The webview must stay on the app, so links open in the default browser.
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href) void openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  // Task content must not trigger network requests, so remote images show as text.
  img: ({ alt }) => <span>{alt}</span>,
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md selectable">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
