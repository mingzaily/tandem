import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import './markdown.css';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [[rehypeHighlight, { detect: false }]] as const;

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
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
        skipHtml
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
