import { Link } from 'react-router-dom';

export function Layout({ children, wide = false }) {
  return (
    <div className={wide ? 'shell shell-wide' : 'shell'}>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Group access
        </Link>
        <nav>
          <Link to="/">Register</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
