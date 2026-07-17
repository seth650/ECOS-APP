import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  emptyLayer,
  syncLayerPrices,
  validateSystem,
} from "./customFloorSystems.js";

const DIAGRAM_NOTE =
  "We'll design a professional system cutaway for a custom fee (quote on request). Process typically takes 5–7 business days. (Feature coming soon — submissions are queued.)";

const IP_NOTE =
  "Systems created in ECOS are owned by Epoxy Twins LLC. You retain usage rights for your business. Attorney audit required — add to Terms of Service before launch.";

export default function MyFloorSystems({ styles: S, session, userProfile }) {
  const [tab, setTab] = useState("systems"); // systems | vendors
  const [systems, setSystems] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Editor
  const [editingId, setEditingId] = useState(null);
  const [systemName, setSystemName] = useState("");
  const [layers, setLayers] = useState([emptyLayer()]);
  const [saving, setSaving] = useState(false);

  // Vendors
  const [vendorName, setVendorName] = useState("");
  const [vendorEmail, setVendorEmail] = useState("");
  const [editingVendorId, setEditingVendorId] = useState(null);

  // Diagram request
  const [diagramSystem, setDiagramSystem] = useState(null);
  const [diagramDesc, setDiagramDesc] = useState("");
  const [diagramName, setDiagramName] = useState("");
  const [diagramEmail, setDiagramEmail] = useState("");

  const userId = session?.user?.id;

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const [sysRes, vendRes] = await Promise.all([
        supabase.from("custom_floor_systems").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
        supabase.from("contractor_vendors").select("*").eq("user_id", userId).order("name"),
      ]);
      if (sysRes.error) throw sysRes.error;
      if (vendRes.error) throw vendRes.error;
      setSystems(sysRes.data || []);
      setVendors(vendRes.data || []);
    } catch (e) {
      setError(
        e?.message?.includes("schema cache") || e?.code === "42P01"
          ? "Database tables not set up yet. Run supabase/custom_floor_systems.sql in the Supabase SQL Editor."
          : e?.message || "Could not load floor systems."
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setDiagramName(
      [userProfile?.first_name, userProfile?.last_name].filter(Boolean).join(" ") ||
        userProfile?.company_name ||
        ""
    );
    setDiagramEmail(userProfile?.email || session?.user?.email || "");
  }, [userProfile, session]);

  function resetEditor() {
    setEditingId(null);
    setSystemName("");
    setLayers([emptyLayer()]);
  }

  function startEdit(sys) {
    setEditingId(sys.id);
    setSystemName(sys.name || "");
    setLayers(Array.isArray(sys.layers) && sys.layers.length ? sys.layers.map((l) => ({ ...emptyLayer(), ...l })) : [emptyLayer()]);
    setTab("systems");
    setMessage("");
  }

  function updateLayer(idx, patch, priceField) {
    setLayers((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        let next = { ...l, ...patch };
        if (priceField) next = syncLayerPrices(next, priceField);
        else if (patch.kitSize !== undefined) next = syncLayerPrices(next, "kitSize");
        return next;
      })
    );
  }

  async function saveSystem() {
    const errs = validateSystem(systemName, layers);
    if (errs.length) {
      setError(errs[0]);
      return;
    }
    if (!userId) return;
    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      user_id: userId,
      name: systemName.trim(),
      layers: layers.map((l) => ({
        id: l.id,
        name: String(l.name || "").trim(),
        type: l.type === "broadcast" ? "broadcast" : "liquid",
        coverageRate: Number(l.coverageRate),
        kitSize: Number(l.kitSize),
        unitType: l.unitType === "lbs" ? "lbs" : "gallons",
        pricePerKit: Number(l.pricePerKit),
        pricePerUnit: Number(l.pricePerUnit) || +(Number(l.pricePerKit) / Number(l.kitSize)).toFixed(4),
        vendorId: l.vendorId || "",
      })),
      updated_at: new Date().toISOString(),
    };
    try {
      if (editingId) {
        const { error: err } = await supabase.from("custom_floor_systems").update(payload).eq("id", editingId).eq("user_id", userId);
        if (err) throw err;
        setMessage("System updated.");
      } else {
        const { error: err } = await supabase.from("custom_floor_systems").insert(payload);
        if (err) throw err;
        setMessage("System saved — it will appear in the calculator picker.");
      }
      resetEditor();
      await loadAll();
    } catch (e) {
      setError(e?.message || "Could not save system.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSystem(id) {
    if (!window.confirm("Delete this custom system?")) return;
    const { error: err } = await supabase.from("custom_floor_systems").delete().eq("id", id).eq("user_id", userId);
    if (err) setError(err.message);
    else {
      if (editingId === id) resetEditor();
      await loadAll();
    }
  }

  async function saveVendor() {
    const name = vendorName.trim();
    const email = vendorEmail.trim();
    if (!name || !email) {
      setError("Vendor name and email required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid vendor email.");
      return;
    }
    setError("");
    try {
      if (editingVendorId) {
        const { error: err } = await supabase
          .from("contractor_vendors")
          .update({ name, email, updated_at: new Date().toISOString() })
          .eq("id", editingVendorId)
          .eq("user_id", userId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("contractor_vendors").insert({ user_id: userId, name, email });
        if (err) throw err;
      }
      setVendorName("");
      setVendorEmail("");
      setEditingVendorId(null);
      setMessage(editingVendorId ? "Vendor updated." : "Vendor added.");
      await loadAll();
    } catch (e) {
      setError(e?.message || "Could not save vendor.");
    }
  }

  async function deleteVendor(id) {
    if (!window.confirm("Delete this vendor?")) return;
    const { error: err } = await supabase.from("contractor_vendors").delete().eq("id", id).eq("user_id", userId);
    if (err) setError(err.message);
    else await loadAll();
  }

  async function submitDiagramRequest() {
    if (!diagramSystem) return;
    const name = diagramName.trim();
    const email = diagramEmail.trim();
    if (!name || !email) {
      setError("Name and email required for diagram request.");
      return;
    }
    try {
      const { error: err } = await supabase.from("diagram_requests").insert({
        user_id: userId,
        system_id: diagramSystem.id,
        system_name: diagramSystem.name,
        contractor_name: name,
        email,
        description: diagramDesc.trim() || null,
      });
      if (err) throw err;
      setMessage("Diagram request submitted — we'll follow up by email.");
      setDiagramSystem(null);
      setDiagramDesc("");
    } catch (e) {
      setError(e?.message || "Could not submit diagram request.");
    }
  }

  const vendorOptions = useMemo(
    () => [{ id: "", name: "— No vendor —" }, ...vendors, { id: "__new__", name: "+ Add new vendor" }],
    [vendors]
  );

  return (
    <div>
      <div style={S.sectionHead}>My Floor Systems</div>
      <div style={{ fontSize: 11, color: "#9bb2d1", marginBottom: 12, lineHeight: 1.5 }}>
        Build reusable custom systems, assign vendors, and use them in the calculator. Tier 2+ only.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          { id: "systems", label: "Systems" },
          { id: "vendors", label: "Vendors" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            style={{
              ...S.btnSm,
              borderColor: tab === t.id ? "#e33433" : "#113a72",
              background: tab === t.id ? "#113a72" : "#000",
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ ...S.card, border: "1px solid #e33433", background: "rgba(227,52,51,0.12)", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#fca5a5" }}>{error}</div>
        </div>
      )}
      {message && (
        <div style={{ ...S.card, border: "1px solid #22c55e", background: "rgba(34,197,94,0.1)", marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#86efac" }}>{message}</div>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 11, color: "#9bb2d1" }}>Loading…</div>
      ) : tab === "vendors" ? (
        <>
          <div style={S.card}>
            <div style={{ fontSize: 13, color: "#fff", fontWeight: 900, marginBottom: 10 }}>
              {editingVendorId ? "Edit vendor" : "Add vendor"}
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
              <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                Name
                <input style={{ ...S.input, marginTop: 4 }} value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="FGP Midwest" />
              </label>
              <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                Email
                <input style={{ ...S.input, marginTop: 4 }} value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)} placeholder="orders@vendor.com" />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" style={S.btnSm} onClick={() => void saveVendor()}>
                {editingVendorId ? "Update vendor" : "Add vendor"}
              </button>
              {editingVendorId && (
                <button
                  type="button"
                  style={S.btnSm}
                  onClick={() => {
                    setEditingVendorId(null);
                    setVendorName("");
                    setVendorEmail("");
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          <div style={S.card}>
            {vendors.length === 0 ? (
              <div style={{ fontSize: 11, color: "#9bb2d1" }}>No vendors yet.</div>
            ) : (
              vendors.map((v) => (
                <div key={v.id} style={{ borderBottom: "1px solid #113a72", padding: "10px 0", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#fff", fontWeight: 900 }}>{v.name}</div>
                    <div style={{ fontSize: 10, color: "#9bb2d1" }}>{v.email}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      style={S.btnSm}
                      onClick={() => {
                        setEditingVendorId(v.id);
                        setVendorName(v.name);
                        setVendorEmail(v.email);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" style={{ ...S.btnSm, borderColor: "#e33433" }} onClick={() => void deleteVendor(v.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        <>
          <div style={S.card}>
            <div style={{ fontSize: 13, color: "#fff", fontWeight: 900, marginBottom: 10 }}>
              {editingId ? "Edit system" : "Create system"}
            </div>
            <label style={{ fontSize: 10, color: "#9bb2d1", display: "block", marginBottom: 12 }}>
              System name
              <input
                style={{ ...S.input, marginTop: 4 }}
                value={systemName}
                onChange={(e) => setSystemName(e.target.value)}
                placeholder="Seth's Premium Metallic"
              />
            </label>

            {layers.map((layer, idx) => (
              <div
                key={layer.id}
                style={{
                  border: "1px solid #113a72",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 10,
                  background: "rgba(0,0,0,0.35)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: "#e33433", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Layer {idx + 1}
                  </div>
                  {layers.length > 1 && (
                    <button
                      type="button"
                      style={{ ...S.btnSm, borderColor: "#e33433", color: "#fca5a5" }}
                      onClick={() => setLayers((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Remove layer
                    </button>
                  )}
                </div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Name
                    <input
                      style={{ ...S.input, marginTop: 4 }}
                      value={layer.name}
                      onChange={(e) => updateLayer(idx, { name: e.target.value })}
                      placeholder="Base Coat"
                    />
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Type
                    <select
                      style={{ ...S.input, marginTop: 4 }}
                      value={layer.type}
                      onChange={(e) => updateLayer(idx, { type: e.target.value })}
                    >
                      <option value="liquid">Liquid</option>
                      <option value="broadcast">Broadcast Media/Additive</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Coverage (sq ft / unit)
                    <input
                      style={{ ...S.input, marginTop: 4 }}
                      type="number"
                      min="0"
                      step="any"
                      value={layer.coverageRate}
                      onChange={(e) => updateLayer(idx, { coverageRate: e.target.value })}
                      placeholder="600"
                    />
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Kit size
                    <input
                      style={{ ...S.input, marginTop: 4 }}
                      type="number"
                      min="0"
                      step="any"
                      value={layer.kitSize}
                      onChange={(e) => updateLayer(idx, { kitSize: e.target.value }, "kitSize")}
                      placeholder="15"
                    />
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Unit type
                    <select
                      style={{ ...S.input, marginTop: 4 }}
                      value={layer.unitType}
                      onChange={(e) => updateLayer(idx, { unitType: e.target.value })}
                    >
                      <option value="gallons">Gallons</option>
                      <option value="lbs">Lbs</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Price per kit ($)
                    <input
                      style={{ ...S.input, marginTop: 4 }}
                      type="number"
                      min="0"
                      step="any"
                      value={layer.pricePerKit}
                      onChange={(e) => updateLayer(idx, { pricePerKit: e.target.value }, "pricePerKit")}
                      placeholder="500"
                    />
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Price per {layer.unitType === "lbs" ? "lb" : "gal"} ($)
                    <input
                      style={{ ...S.input, marginTop: 4 }}
                      type="number"
                      min="0"
                      step="any"
                      value={layer.pricePerUnit}
                      onChange={(e) => updateLayer(idx, { pricePerUnit: e.target.value }, "pricePerUnit")}
                      placeholder="auto"
                    />
                  </label>
                  <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                    Vendor
                    <select
                      style={{ ...S.input, marginTop: 4 }}
                      value={layer.vendorId || ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new__") {
                          setTab("vendors");
                          return;
                        }
                        updateLayer(idx, { vendorId: v });
                      }}
                    >
                      {vendorOptions.map((v) => (
                        <option key={v.id || "none"} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ))}

            <button type="button" style={{ ...S.btnSm, marginBottom: 12 }} onClick={() => setLayers((prev) => [...prev, emptyLayer()])}>
              + Add layer
            </button>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={{ ...S.btn, marginTop: 0, opacity: saving ? 0.7 : 1 }} disabled={saving} onClick={() => void saveSystem()}>
                {saving ? "Saving…" : editingId ? "Update system" : "Save as reusable system"}
              </button>
              {editingId && (
                <button type="button" style={S.btnSm} onClick={resetEditor}>
                  Cancel edit
                </button>
              )}
            </div>
          </div>

          <div style={{ ...S.sectionHead, marginTop: 8 }}>Saved systems</div>
          <div style={S.card}>
            {systems.length === 0 ? (
              <div style={{ fontSize: 11, color: "#9bb2d1" }}>No custom systems yet.</div>
            ) : (
              systems.map((sys) => (
                <div key={sys.id} style={{ borderBottom: "1px solid #113a72", padding: "12px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, color: "#fff", fontWeight: 900 }}>
                        {sys.name}{" "}
                        <span style={{ fontSize: 9, color: "#eab308", border: "1px solid #eab308", borderRadius: 4, padding: "1px 5px", marginLeft: 4 }}>
                          CUSTOM
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "#9bb2d1", marginTop: 3 }}>
                        {(sys.layers || []).length} layer(s) · Updated {sys.updated_at ? new Date(sys.updated_at).toLocaleDateString() : "—"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button type="button" style={S.btnSm} onClick={() => startEdit(sys)}>
                        Edit
                      </button>
                      <button type="button" style={S.btnSm} onClick={() => setDiagramSystem(sys)}>
                        Submit for Custom Diagram
                      </button>
                      <button type="button" style={{ ...S.btnSm, borderColor: "#e33433" }} onClick={() => void deleteSystem(sys.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {diagramSystem && (
            <div style={{ ...S.card, border: "1px solid #eab308", marginTop: 12 }}>
              <div style={{ fontSize: 13, color: "#f5d676", fontWeight: 900, marginBottom: 6 }}>
                Custom diagram — {diagramSystem.name}
              </div>
              <div style={{ fontSize: 11, color: "#d2def1", lineHeight: 1.5, marginBottom: 10 }}>{DIAGRAM_NOTE}</div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                  Contractor name
                  <input style={{ ...S.input, marginTop: 4 }} value={diagramName} onChange={(e) => setDiagramName(e.target.value)} />
                </label>
                <label style={{ fontSize: 10, color: "#9bb2d1" }}>
                  Email
                  <input style={{ ...S.input, marginTop: 4 }} value={diagramEmail} onChange={(e) => setDiagramEmail(e.target.value)} />
                </label>
              </div>
              <label style={{ fontSize: 10, color: "#9bb2d1", display: "block", marginTop: 10 }}>
                Brief description
                <textarea
                  style={{ ...S.input, marginTop: 4, minHeight: 72, resize: "vertical" }}
                  value={diagramDesc}
                  onChange={(e) => setDiagramDesc(e.target.value)}
                  placeholder="Colors, layer stack, cutaway notes…"
                />
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" style={S.btnSm} onClick={() => void submitDiagramRequest()}>
                  Submit request
                </button>
                <button type="button" style={S.btnSm} onClick={() => setDiagramSystem(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div style={{ ...S.card, marginTop: 16, border: "1px solid #113a72", background: "rgba(15,36,64,0.6)" }}>
        <div style={{ fontSize: 10, color: "#9bb2d1", lineHeight: 1.55 }}>{IP_NOTE}</div>
      </div>
    </div>
  );
}
