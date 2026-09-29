import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import { renderRulebook } from '../../markdown.js';

export const PageHead: FC<PropsWithChildren<{ title: string; sub?: Child }>> = ({ title, sub, children }) => (
  <div class="head">
    <div>
      <h1>{title}</h1>
      {sub ? <p class="sub">{sub}</p> : null}
    </div>
    {children ? <div class="actions">{children}</div> : null}
  </div>
);

/** Renders rulebook text safely: blocks are plain text and JSX escapes every string. */
export const Rulebook: FC<{ text: string }> = ({ text }) => (
  <div class="md">
    {renderRulebook(text).map((block) =>
      block.type === 'heading' ? (
        <h2>{block.text}</h2>
      ) : block.type === 'list' ? (
        <ul>
          {block.items.map((item) => (
            <li>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{block.text}</p>
      ),
    )}
  </div>
);

export const heroImage = (slug: string): string => `/assets/heroes/${slug}.png`;
