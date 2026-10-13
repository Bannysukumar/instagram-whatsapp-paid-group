import { Link } from 'react-router-dom';

export function Layout({ children }) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">Group access</Link>
        <nav>
          <Link to="/">Register</Link>
          <Link to="/admin">Admin</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
