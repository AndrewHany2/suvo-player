import { useState, useEffect, useRef } from "react";
import { useApp, useChannels } from "../context/AppContext";
import { contentService } from "../domain/services/ContentService";
import Icon from "../ui/Icon";
import { colors, iconSizes, fonts } from "../ui/tokens";
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

// Text-input fields for a source type. Focus index 0 is the type toggle; the
// inputs follow (indices 1..N); then Cancel and Save. Deriving the field set
// here keeps the M3U/Xtream difference — and all the d-pad index math — in one
// place instead of hardcoded constants.
const inputFieldsFor = (type) =>
  type === "m3u"
    ? [
        { key: "nickname", label: "Nickname (optional)", placeholder: "My playlist", type: "text" },
        { key: "url", label: "Playlist URL *", placeholder: "http://host/get.php?…  or  .m3u / .m3u8", type: "text", autoCapitalize: "none", autoCorrect: "off", hint: "From your provider's welcome email." },
      ]
    : [
        { key: "nickname", label: "Nickname (optional)", placeholder: "My account", type: "text" },
        { key: "host", label: "Host *", placeholder: "server.example.com:8080", type: "text", autoCapitalize: "none", autoCorrect: "off", hint: "From your provider's welcome email." },
        { key: "username", label: "Username *", placeholder: "username", type: "text", autoCapitalize: "none", autoCorrect: "off", hint: "The username your provider gave you." },
        { key: "password", label: "Password *", placeholder: "password", type: "password", hint: "The password your provider gave you." },
      ];
const TOGGLE_IDX = 0;

export default function AccountsScreenTV({ navigation }) {
  const { users, activeUserId, setActiveUserId, saveUsers, addUser, updateUser, removeUser, tvUseShelves, setTvUseShelves } = useApp();
  const { setChannels } = useChannels();

  const [view,         setView]         = useState("list");
  const [focus,        setFocus]        = useState(0);
  // Column within a focused account row: 0=connect (whole row), 1=Edit, 2=Delete.
  const [col,          setCol]          = useState(0);
  const [fieldFocus,   setFieldFocus]   = useState(0);
  const [confirmFocus, setConfirmFocus] = useState(0); // 0=cancel 1=delete — default to Cancel (safe: OK won't delete)
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [editId,       setEditId]       = useState(null);
  const [delId,        setDelId]        = useState(null);
  const [form,         setForm]         = useState({ type: "xtream", nickname: "", host: "", username: "", password: "", url: "" });
  const [showPwd,      setShowPwd]      = useState(false);

  // Focusable model + values the (once-bound, frozen) key listener reads via
  // refs so type-driven field changes and the latest form values are always
  // seen — the captured render-0 closure cannot see later render scope.
  const inputFields = inputFieldsFor(form.type);
  const CANCEL_IDX  = inputFields.length + 1;
  const SAVE_IDX    = inputFields.length + 2;
  const FORM_TOTAL  = inputFields.length + 3;
  const modelRef    = useRef(null);
  modelRef.current  = { inputFields, cancelIdx: CANCEL_IDX, saveIdx: SAVE_IDX, total: FORM_TOTAL };
  const formRef     = useRef(form);
  formRef.current   = form;
  const editIdRef   = useRef(null);
  editIdRef.current = editId;

  const focusRef      = useRef(0);
  const colRef        = useRef(0);
  const setColF       = (c) => { colRef.current = c; setCol(c); };
  const fieldFocRef   = useRef(0);
  const confirmFocRef = useRef(0);
  const viewRef       = useRef("list");
  const rowsRef       = useRef([]);
  const elRef         = useRef(null);

  const nicknameRef = useRef(null);
  const hostRef     = useRef(null);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
  const urlRef      = useRef(null);
  // Stable ref per field key (all keys always present so the frozen key
  // listener can focus whichever inputs the current type renders).
  const refByKey    = { nickname: nicknameRef, host: hostRef, username: usernameRef, password: passwordRef, url: urlRef };

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

  // Switch source type, remapping the field set. Clamp the focused index into
  // the new (possibly shorter) model so an M3U form can't leave focus past Save.
  const setFormType = (t) => {
    setForm((f) => (f.type === t ? f : { ...f, type: t }));
    const nextTotal = inputFieldsFor(t).length + 3;
    if (fieldFocRef.current > nextTotal - 1) { fieldFocRef.current = nextTotal - 1; setFieldFocus(nextTotal - 1); }
  };

  // ── Form keys ──────────────────────────────────────────────────────────────
  // Reads the focusable model + form values via refs (modelRef/formRef) because
  // the keydown listener is bound once and can't see later render scope.
  const handleFormKey = (k, e) => {
    const fi = fieldFocRef.current;
    const { inputFields: ifs, cancelIdx, saveIdx, total } = modelRef.current;
    const setFi = (n) => { fieldFocRef.current = n; setFieldFocus(n); };
    switch (k) {
      case KEY_UP:   e.preventDefault(); setFi(Math.max(0, fi - 1)); break;
      case KEY_DOWN: e.preventDefault(); setFi(Math.min(total - 1, fi + 1)); break;
      case KEY_LEFT:
        if (fi === TOGGLE_IDX) { e.preventDefault(); setFormType("xtream"); }
        else if (fi === saveIdx) { e.preventDefault(); setFi(cancelIdx); }
        break;
      case KEY_RIGHT:
        if (fi === TOGGLE_IDX) { e.preventDefault(); setFormType("m3u"); }
        else if (fi === cancelIdx) { e.preventDefault(); setFi(saveIdx); }
        break;
      case KEY_ENTER: {
        e.preventDefault();
        if (fi === TOGGLE_IDX) setFormType(formRef.current.type === "m3u" ? "xtream" : "m3u");
        else if (fi >= 1 && fi <= ifs.length) refByKey[ifs[fi - 1].key].current?.focus(); // open virtual keyboard
        else if (fi === cancelIdx) setView("list");             // Cancel
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
    if (view === "confirm") { confirmFocRef.current = 0; setConfirmFocus(0); }
    if (view === "list")    setColF(0); // land on the connect column
  }, [view]);

  const openAddForm = () => {
    setForm({ type: "xtream", nickname: "", host: "", username: "", password: "", url: "" });
    setShowPwd(false);
    setEditId(null); setError(""); setView("form");
  };

  const openEditForm = (user) => {
    setForm({
      type: user.type === "m3u" ? "m3u" : "xtream",
      nickname: user.nickname || "", host: user.host || "", username: user.username || "",
      password: user.password || "", url: user.url || "",
    });
    setShowPwd(false);
    setEditId(user.id); setError(""); setView("form");
  };

  const saveForm = async () => {
    const f = formRef.current;
    const missing = f.type === "m3u" ? !f.url : (!f.host || !f.username || !f.password);
    if (missing) { setError(f.type === "m3u" ? "Playlist URL is required." : "Host, Username and Password are required."); return; }
    setLoading(true); setError("");
    try {
      if (editIdRef.current) await updateUser(editIdRef.current, f);
      else await addUser(f);
      setView("list");
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally { setLoading(false); }
  };

  const connectUser = (userId) => {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    // Switching the active user is all that's needed: setActiveUserId drives the
    // AppContext effect that reconfigures contentService (Xtream or M3U by the
    // account's type), and each screen's data hook (e.g. useLiveTV) reloads its
    // own categories keyed on activeUserId.
    // We deliberately do NOT fetch the whole live catalog here — the TV screens
    // never consume the context `channels`, and dumping a multi-MB array into
    // state forces a blocking JSON.stringify to webOS localStorage that made the
    // app crawl after every account switch.
    setActiveUserId(userId); saveUsers();
    contentService.configure(user);
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
        <div className="tvl-topbar"><span className="tvl-topbar-title" role="heading" aria-level={1}>Delete Account</span></div>
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
    return (
      <div className="tvl-screen">
        <div className="tvl-topbar">
          <button className="tvl-topbar-back" onClick={() => setView("list")} aria-label="Back"><Icon name="back" size={iconSizes.md} color={colors.accent} /></button>
          <span className="tvl-topbar-title" role="heading" aria-level={1}>{editId ? "Edit Account" : "Add Account"}</span>
        </div>
        <div className="tvl-form">
          {error && <div className="tvl-acc-error"><Icon name="warning" size={iconSizes.sm} color={colors.danger} /><span>{error}</span></div>}

          <div
            role="none"
            className={fieldFocus === TOGGLE_IDX ? "tvl-field tvl-field--on" : "tvl-field"}
            onClick={() => { fieldFocRef.current = TOGGLE_IDX; setFieldFocus(TOGGLE_IDX); }}
          >
            <label>Source type</label>
            <div className="tvl-seg">
              {[{ key: "xtream", label: "Xtream login" }, { key: "m3u", label: "M3U playlist" }].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={form.type === opt.key ? "tvl-btn tvl-seg-btn--active" : "tvl-btn tvl-btn-ghost"}
                  onClick={(e) => { e.stopPropagation(); setFormType(opt.key); }}
                  disabled={loading}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {inputFields.map((f, i) => {
            const idx = i + 1; // index 0 is the type toggle
            return (
              <div
                key={f.key}
                role="none"
                className={fieldFocus === idx ? "tvl-field tvl-field--on" : "tvl-field"}
                onClick={() => { fieldFocRef.current = idx; setFieldFocus(idx); refByKey[f.key].current?.focus(); }}
              >
                <label>{f.label}</label>
                <div style={{ position: "relative" }}>
                  <input
                    ref={refByKey[f.key]}
                    type={f.type === "password" && showPwd ? "text" : f.type}
                    aria-label={f.label}
                    placeholder={f.placeholder}
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    onBlur={() => { fieldFocRef.current = idx; setFieldFocus(idx); }}
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
                {f.hint && (
                  <span style={{ color: colors.muted, fontFamily: fonts.body, fontSize: 13 }}>{f.hint}</span>
                )}
              </div>
            );
          })}

          <div className="tvl-form-actions">
            <button
              className={fieldFocus === CANCEL_IDX ? "tvl-btn tvl-btn-ghost tvl-btn--on" : "tvl-btn tvl-btn-ghost"}
              onClick={() => setView("list")}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className={fieldFocus === SAVE_IDX ? "tvl-btn tvl-btn--on" : "tvl-btn"}
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
      <div className="tvl-topbar"><span className="tvl-topbar-title" role="heading" aria-level={1}>Accounts</span></div>
      {error && <div className="tvl-acc-error" style={{ margin: "0 48px" }}><Icon name="warning" size={iconSizes.sm} color={colors.danger} /><span>{error}</span></div>}
      {loading && <div className="tvl-center" style={{ flex: "0 0 auto", padding: "20px" }}><div className="tvl-spinner" /></div>}
      <div className="tvl-scroll">
        <div className="tvl-acc-list">
          <button
            ref={focus === 0 ? elRef : null}
            className={focus === 0 ? "tvl-acc-add tvl-acc-add--on" : "tvl-acc-add"}
            onClick={openAddForm}
          >
            <Icon name="plus" size={iconSizes.md} color={colors.accent} />
            <span>Add account</span>
          </button>

          {users.map((user, i) => {
            const rowIdx = i + 1;
            const isFocused = focus === rowIdx;
            // col 0 = whole-row connect (owns the cyan focus ring); col>0 hands
            // the ring to the focused action button and the row shows a quieter
            // indigo "active context" affordance instead of a second cyan ring.
            let rowClass = "tvl-acc-item";
            if (isFocused) rowClass += col === 0 ? " tvl-acc-item--on" : " tvl-acc-item--rowfocus";
            const accountName = user.nickname || (user.type === "m3u" ? "M3U playlist" : `${user.username}@${user.host}`);
            return (
              <div
                key={user.id}
                role="button"
                aria-label={`Connect ${accountName}`}
                aria-selected={isFocused && col === 0}
                ref={isFocused ? elRef : null}
                className={rowClass}
                onClick={() => connectUser(user.id)}
              >
                <div className="tvl-acc-info">
                  <div className="tvl-acc-name">{accountName}</div>
                  <div className="tvl-acc-host">{user.type === "m3u" ? user.url : user.host}</div>
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

          <div style={{ padding: "8px 4px 4px", color: colors.muted, fontFamily: fonts.body, fontSize: 14 }}>
            Need help connecting? Visit suvo.app/help
          </div>
        </div>
      </div>
    </div>
  );
}
