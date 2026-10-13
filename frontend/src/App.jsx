import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AdminDashboardPage } from './pages/AdminDashboardPage.jsx';
import { AdminLoginPage } from './pages/AdminLoginPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { StatusPage } from './pages/StatusPage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RegisterPage />} />
        <Route path="/status/:id" element={<StatusPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<AdminDashboardPage />} />
      </Routes>
    </BrowserRouter>
  );
}
