import React from "react";
import { BrowserRouter, Routes, Route, Navigate, NavLink } from "react-router-dom";
import { useAuth } from "./auth";
import { Button } from "./ui";
import Login from "./screens/Login";
import Overview from "./screens/Overview";
import Accounts from "./screens/Accounts";
import CreateAccount from "./screens/CreateAccount";
import AccountDetail from "./screens/AccountDetail";
import Providers from "./screens/Providers";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const { me, loading } = useAuth();

  if (loading) {
    return (
      <div className="center-page">
        <p>Loading…</p>
      </div>
    );
  }

  if (!me) return <Login />;

  return (
    <div className="app-shell">
      <TopBar />
      <main>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/new" element={<CreateAccount />} />
          <Route path="/accounts/:userId" element={<AccountDetail />} />
          {me.role === "super_admin" && <Route path="/providers" element={<Providers />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function TopBar() {
  const { me, logout } = useAuth();
  if (!me) return null;

  return (
    <header className="topbar">
      <div className="topbar-brand">Suvo</div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Overview
        </NavLink>
        <NavLink to="/accounts" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
          Accounts
        </NavLink>
        {me.role === "super_admin" && (
          <NavLink to="/providers" className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            Providers
          </NavLink>
        )}
      </nav>
      <div className="topbar-user">
        <span className="topbar-name">{me.name}</span>
        <span className="topbar-role">{me.role === "super_admin" ? "Super admin" : "Provider"}</span>
        <Button variant="ghost" onClick={logout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
