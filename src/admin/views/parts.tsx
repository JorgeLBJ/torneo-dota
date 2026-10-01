import { raw } from 'hono/html';
import type { Child, FC, JSX, PropsWithChildren } from 'hono/jsx';

export const PageHead: FC<PropsWithChildren<{ title: string; sub?: Child }>> = ({ title, sub, children }) => (
  <div class="head">
    <div>
      <h1>{title}</h1>
      {sub ? <p class="sub">{sub}</p> : null}
    </div>
    {children ? <div class="actions">{children}</div> : null}
  </div>
);

export const heroImage = (slug: string): string => `/assets/heroes/${slug}.png`;

// Where the browser supports customizable selects, this button + selectedcontent is what the closed select
// shows (text with ellipsis, then the chevron). Other browsers ignore it. Every admin select goes through here.
const SELECT_FACE = raw('<button><selectedcontent></selectedcontent></button>');

export const Select: FC<JSX.IntrinsicElements['select']> = ({ children, ...props }) => (
  <select {...props}>
    {SELECT_FACE}
    {children}
  </select>
);
