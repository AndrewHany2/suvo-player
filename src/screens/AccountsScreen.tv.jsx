import { useState, useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import iptvApi from "../services/iptvApi";
import Icon from "../ui/Icon";
import { colors, iconSizes } from "../ui/tokens";
import { isMacCommand } from "../platform/adapters/input/keys";
import "../styles/tvl.css";
import "../styles/tvResponsiveScaling.css";
import "../styles/tvRemoteFocus.css";
import "./AccountsScreen.tv.css";

const KEY_UP    = 38;
const KEY_DOWN  = 40;
const KEY_LEFT  = 37;
const KEY_RIGHT = 39;
const KEY_ENTER = 13;
const KEY_BACK  = new Set([27, 461, 10009, 8, 91]);

const FORM_INPUTS = 4; // first 4 fieldFocus indices are text inputs
const FORM_TOTAL  = 6; // + cancel(4) + save(5)

export default function AccountsScreenTV({ navigation }) {
  const { users, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser, setChannels, tvUseShelves, setTvUseShelves } = useApp();

  const [view,         setView]         = useState("list");
  const [focus,        setFocus]        = useState(0);
  // Column within a focused account row: 0=connect (whole row), 1=Edit, 2=Delete.
  const [col,          setCol]          = useState(0);
  const [fieldFocus,   setFieldFocus]   = useState(0);
  const [confirmFocus, setConfirmFocus] = useState(1); // 0=cancel 1=delete
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [editId,       setEditId]       = useState(null);
  const [delId,        setDelId]        = useState(null);
  const [form,         setForm]         = useState({ nickname: "", host: "", username: "", password: "" });
  const [showPwd,      setShowPwd]      = useState(false);

  const focusRef      = useRef(0);
  const colRef        = useRef(0);
  const setColF       = (c) => { colRef.current = c; setCol(c); };
  const fieldFocRef   = useRef(0);
  const confirmFocRef = useRef(1);
  const viewRef       = useRef("list");
  const rowsRef       = useRef([]);
  const elRef         = useRef(null);

  const nicknameRef = useRef(null);
  const hostRef     = useRef(null);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const inputRefs   = [nicknameRef, hostRef, usernameRef, passwordRef];

  // "add" row, one row per account, then a trailing settings row (TV layout toggle).
  const rows = ["add", ...users.map((u) => u.id), "settings_shelves"];
  const isAccountRow = (r) => r !== "add" && r !== "settings_shelves";
  useEffect(() => { rowsRef.current = rows; });
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { fieldFocRef.current = fieldFocus; }, [fieldFocus]);
  useEffect(() => { confirmFocRef.current = confirmFocus; }, [confirmFocus]);

  // Returns true when an input/textarea has native browser focus (virtual keyboard open)
  const inputActive = () => {
    const el = document.activeElement;
    return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
  };

  // This modal OWNS the remote while mounted: a capture-phase listener that
  // stopImmediatePropagation()s every nav key so the screen behind the Accounts
  // overlay never moves its own ring, then drives our index nav. (Replaces the
  // external useModalKeyTrap that used to wrap this in AppNavigator — that trap
  // fired in capture and killed this handler, so d-nav did nothing here.)
  const NAV_KEYS = new Set([KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN, KEY_ENTER]);
  useEffect(() => {
    const onKey = (e) => {
      if (isMacCommand(e)) return; // ⌘ shares keyCode 91 with Back in the sim
      const k = e.keyCode || e.which;
      const isNav = NAV_KEYS.has(k) || KEY_BACK.has(k);
      if (isNav) e.stopImmediatePropagation(); // shield the background screen

      // Virtual keyboard open: arrows drive the caret; Enter/Back blur the field
      // and hand control back to our ring (matching useTVNavigation/useModalKeyTrap).
      if (inputActive()) {
        if (k === KEY_ENTER || KEY_BACK.has(k)) {
          e.preventDefault();
          document.activeElement.blur();
        }
        return;
      }

      const v = viewRef.current;
      if (v === "list")         handleListKey(k, e);
      else if (v === "form")    handleFormKey(k, e);
      else if (v === "confirm") handleConfirmKey(k, e);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  // Single capture-phase key router bound once; it dispatches through viewRef
  // and the zone handlers read live state via refs, so deps stay empty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── List keys ──────────────────────────────────────────────────────────────
  const handleListKey = (k, e) => {
    const list = rowsRef.current;
    switch (k) {
      case KEY_UP: {
        e.preventDefault();
        const n = Math.max(0, focusRef.current - 1);
        focusRef.current = n; setFocus(n);
        setColF(0); // reset to the connect column when changing rows
        break;
      }
      case KEY_DOWN: {
        e.preventDefault();
        const n = Math.min(list.length - 1, focusRef.current + 1);
        focusRef.current = n; setFocus(n);
        setColF(0);
        break;
      }
      case KEY_LEFT: {
        // Move across a row's actions (connect → Edit → Delete). The "add" and
        // settings rows have no columns, so they stay put.
        if (isAccountRow(list[focusRef.current])) { e.preventDefault(); setColF(Math.max(0, colRef.current - 1)); }
        break;
      }
      case KEY_RIGHT: {
        if (isAccountRow(list[focusRef.current])) { e.preventDefault(); setColF(Math.min(2, colRef.current + 1)); }
        break;
      }
      case KEY_ENTER: {
        e.preventDefault();
        activateListRow(list[focusRef.current]);
        break;
      }
      default: if (KEY_BACK.has(k)) { e.preventDefault(); navigation.goBack?.(); }
    }
  };

  // Enter action for the focused list row (kept out of the switch to keep
  // handleListKey's complexity in check).
  const activateListRow = (row) => {
    if (row === "add") { openAddForm(); return; }
    if (row === "settings_shelves") { setTvUseShelves(!tvUseShelves); return; }
    if (colRef.current === 1) { const u = users.find((x) => x.id === row); if (u) openEditForm(u); }
    else if (colRef.current === 2) { setDelId(row); setView("confirm"); }
    else connectUser(row);
  };

  // ── Form keys ──────────────────────────────────────────────────────────────
  const handleFormKey = (k, e) => {
    const fi = fieldFocRef.current;
    switch (k) {
      case KEY_UP: {
        e.preventDefault();
        const prev = Math.max(0, fi - 1);
        fieldFocRef.current = prev; setFieldFocus(prev);
        break;
      }
      case KEY_DOWN: {
        e.preventDefault();
        const next = Math.min(FORM_TOTAL - 1, fi + 1);
        fieldFocRef.current = next; setFieldFocus(next);
        break;
      }
      case KEY_LEFT: {
        if (fi >= FORM_INPUTS) { e.preventDefault(); const p = Math.max(FORM_INPUTS, fi - 1); fieldFocRef.current = p; setFieldFocus(p); }
        break;
      }
      case KEY_RIGHT: {
        if (fi >= FORM_INPUTS) { e.preventDefault(); const n = Math.min(FORM_TOTAL - 1, fi + 1); fieldFocRef.current = n; setFieldFocus(n); }
        break;
      }
      case KEY_ENTER: {
        e.preventDefault();
        if (fi < FORM_INPUTS) inputRefs[fi].current?.focus(); // open virtual keyboard
        else if (fi === FORM_INPUTS) setView("list");           // Cancel
        else saveForm();                                        // Save
        break;
      }
      default: if (KEY_BACK.has(k)) { e.preventDefault(); setView("list"); }
    }
  };

  // ── Confirm keys ───────────────────────────────────────────────────────────
  const handleConfirmKey = (k, e) => {
    const cf = confirmFocRef.current;
    switch (k) {
      case KEY_LEFT: case KEY_UP:    e.preventDefault(); confirmFocRef.current = 0; setConfirmFocus(0); break;
      case KEY_RIGHT: case KEY_DOWN: e.preventDefault(); confirmFocRef.current = 1; setConfirmFocus(1); break;
      case KEY_ENTER: {
        e.preventDefault();
        if (cf === 0) { setView("list"); setDelId(null); }
        else confirmDelete();
        break;
      }
      default: if (KEY_BACK.has(k)) { e.preventDefault(); setView("list"); setDelId(null); }
    }
  };

  useEffect(() => { elRef.current?.scrollIntoView({ block: "nearest" }); }, [focus]);

  // Reset focused field index when switching views
  useEffect(() => {
    if (view === "form")    { fieldFocRef.current = 1; setFieldFocus(1); } // start on Host
    if (view === "confirm") { confirmFocRef.current = 1; setConfirmFocus(1); }
    if (view === "list")    setColF(0); // land on the connect column
  }, [view]);

  const openAddForm = () => {
    setForm({ nickname: "", host: "", username: "", password: "" });
    setShowPwd(false);
    setEditId(null); setError(""); setView("form");
  };

  const openEditForm = (user) => {
    setForm({ nickname: user.nickname || "", host: user.host, username: user.username, password: user.password });
    setShowPwd(false);
    setEditId(user.id); setError(""); setView("form");
  };

  const saveForm = async () => {
    if (!form.host || !form.username || !form.password) { setError("Host, Username and Password are required."); return; }
    setLoading(true); setError("");
    try {
      if (editId) await updateUser(editId, form);
      else await addUser(form);
      setView("list");
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally { setLoading(false); }
  };

  const connectUser = (userId) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    // Switching the active user is all that's needed: setActiveUserId drives the
    // AppContext effect that swaps iptvApi credentials, and each screen's data
    // hook (e.g. useLiveTV) reloads its own categories keyed on activeUserId.
    // We deliberately do NOT fetch the whole live catalog here — the TV screens
    // never consume the context `channels`, and dumping a multi-MB array into
    // state forces a blocking JSON.stringify to webOS localStorage that made the
    // app crawl after every account switch.
    setActiveUserId(userId); saveUsers();
    iptvApi.setCredentials(user.host, user.username, user.password);
    setChannels([]);
    navigation.goBack?.();
  };

  const confirmDelete = async () => {
    setLoading(true);
    try { await removeUser(delId); setDelId(null); setView("list"); }
    catch (err) { setError(err.message || "Failed to delete"); }
    finally { setLoading(false); }
  };

  // ── Confirm dialog ────────────────────────────────────────────────────────
  if (view === "confirm") {
    const user = users.find((u) => u.id === delId);
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar"><span className="tvl-topbar-title">Delete Account</span></div>
        <div className="tvl-confirm">
          <p>Delete &ldquo;{user?.nickname || user?.username}&rdquo;?</p>
          <div className="tvl-confirm-actions">
            <button
              className={confirmFocus === 0 ? "tvl-btn tvl-btn-ghost tvl-btn--on" : "tvl-btn tvl-btn-ghost"}
              onClick={() => { setView("list"); setDelId(null); }}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={confirmFocus === 1 ? "tvl-btn tvl-btn-danger tvl-btn--on" : "tvl-btn tvl-btn-danger"}
              onClick={confirmDelete}
              disabled={loading}
            >
              {loading ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form view ─────────────────────────────────────────────────────────────
  if (view === "form") {
    const fields = [
      { key: "nickname", label: "Nickname (optional)", placeholder: "My IPTV",                 type: "text",     ref: nicknameRef },
      { key: "host",     label: "Host *",               placeholder: "server.example.com:8080", type: "text",     ref: hostRef,     autoCapitalize: "none", autoCorrect: "off" },
      { key: "username", label: "Username *",            placeholder: "username",                type: "text",     ref: usernameRef, autoCapitalize: "none", autoCorrect: "off" },
      { key: "password", label: "Password *",            placeholder: "password",                type: "password", ref: passwordRef },
    ];

    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className="tvl-topbar-back" onClick={() => setView("list")} aria-label="Back"><Icon name="back" size={iconSizes.md} color={colors.accent} /></button>
          <span className="tvl-topbar-title">{editId ? "Edit Account" : "Add Account"}</span>
        </div>
        <div className="tvl-form">
          {error && <div className="tvl-acc-error"><Icon name="warning" size={iconSizes.sm} color={colors.danger} /><span>{error}</span></div>}

          {fields.map((f, i) => (
            <div
              key={f.key}
              role="none"
              className={fieldFocus === i ? "tvl-field tvl-field--on" : "tvl-field"}
              onClick={() => { fieldFocRef.current = i; setFieldFocus(i); f.ref.current?.focus(); }}
            >
              <label>{f.label}</label>
              <div style={{ position: "relative" }}>
                <input
                  ref={f.ref}
                  type={f.type === "password" && showPwd ? "text" : f.type}
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  onBlur={() => { fieldFocRef.current = i; setFieldFocus(i); }}
                  disabled={loading}
                  autoCapitalize={f.autoCapitalize}
                  autoCorrect={f.autoCorrect}
                  style={f.type === "password" ? { paddingRight: 48 } : undefined}
                />
                {f.type === "password" && (
                  <button
                    type="button"
                    className="tvl-pwd-eye"
                    aria-label={showPwd ? "Hide password" : "Show password"}
                    onClick={(e) => { e.stopPropagation(); setShowPwd((s) => !s); }}
                  >
                    <Icon name={showPwd ? "eye-off" : "eye"} size={iconSizes.md} color={colors.muted} />
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="tvl-form-actions">
            <button
              className={fieldFocus === 4 ? "tvl-btn tvl-btn-ghost tvl-btn--on" : "tvl-btn tvl-btn-ghost"}
              onClick={() => setView("list")}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={fieldFocus === 5 ? "tvl-btn tvl-btn--on" : "tvl-btn"}
              onClick={saveForm}
              disabled={loading}
            >
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div className="tvl-screen">
      <div className="tvl-topbar"><span className="tvl-topbar-title">Accounts</span></div>
      {error && <div className="tvl-acc-error" style={{ margin: "0 48px" }}><Icon name="warning" size={iconSizes.sm} color={colors.danger} /><span>{error}</span></div>}
      {loading && <div className="tvl-center" style={{ flex: "0 0 auto", padding: "20px" }}><div className="tvl-spinner" /></div>}
      <div className="tvl-scroll">
        <div className="tvl-acc-list">
          <button
            ref={focus === 0 ? elRef : null}
            className={focus === 0 ? "tvl-acc-add tvl-acc-add--on" : "tvl-acc-add"}
            onClick={openAddForm}
          >
            <Icon name="plus" size={iconSizes.md} color={colors.danger} />
            <span>Add IPTV Account</span>
          </button>

          {users.map((user, i) => {
            const rowIdx = i + 1;
            const isFocused = focus === rowIdx;
            return (
              <div
                key={user.id}
                role="none"
                ref={isFocused ? elRef : null}
                className={isFocused ? "tvl-acc-item tvl-acc-item--on" : "tvl-acc-item"}
                onClick={() => connectUser(user.id)}
              >
                <div className="tvl-acc-info">
                  <div className="tvl-acc-name">{user.nickname || `${user.username}@${user.host}`}</div>
                  <div className="tvl-acc-host">{user.host}</div>
                  {activeUserId === user.id && <div className="tvl-acc-badge"><Icon name="check" size={iconSizes.sm} color={colors.accent2} /><span>Active</span></div>}
                </div>
                <div className="tvl-acc-actions">
                  <button className={isFocused && col === 1 ? "tvl-acc-btn tvl-acc-btn--on" : "tvl-acc-btn"} onClick={(e) => { e.stopPropagation(); openEditForm(user); }}>Edit</button>
                  <button className={isFocused && col === 2 ? "tvl-acc-btn tvl-acc-btn-danger tvl-acc-btn--on" : "tvl-acc-btn tvl-acc-btn-danger"} onClick={(e) => { e.stopPropagation(); setDelId(user.id); setView("confirm"); }}>Delete</button>
                </div>
              </div>
            );
          })}

          {(() => {
            const settingsIdx = users.length + 1;
            const isFocused = focus === settingsIdx;
            return (
              <button
                ref={isFocused ? elRef : null}
                className={isFocused ? "tvl-acc-item tvl-acc-item--on" : "tvl-acc-item"}
                onClick={() => setTvUseShelves(!tvUseShelves)}
              >
                <div className="tvl-acc-info">
                  <div className="tvl-acc-name">TV Layout</div>
                  <div className="tvl-acc-host">How Movies &amp; Series browse</div>
                </div>
                <div className="tvl-acc-actions">
                  <span className="tvl-acc-badge">
                    <Icon name="tv" size={iconSizes.sm} color={colors.accent2} />
                    <span>{tvUseShelves ? "Shelves" : "Grid"}</span>
                  </span>
                </div>
              </button>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
