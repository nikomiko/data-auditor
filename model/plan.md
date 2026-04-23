# Migration Plan: YAML → JSON Schema Config

## Overview
Migrate DataAuditor configuration from YAML-based (current) to JSON Schema-validated format (src/schema.json v1.0.0). The new schema introduces semantic changes to configuration structure and field naming.

## Key Schema Changes

### 1. **Source Naming: `reference`/`target` → `left`/`right`**
   - Current YAML: `sources.reference`, `sources.target`
   - New JSON: `sources.left`, `sources.right`
   - **Impact**: All code reading `config["sources"]["reference"]` and `["target"]` must switch to `["left"]` and `["right"]`

### 2. **Rule Type Values: `coherence`/`incoherence` → `OK`/`KO`**
   - Current: `rule_type: coherence | incoherence` (logical intent-based)
   - New: `rule_type: OK | KO` (outcome-based, different semantics)
   - **Impact**: Comparator logic must be updated; `coherence` rules never fail, `incoherence` rules fail on discrepancies
   - **Breaking**: Logic inversion required in rule evaluation

### 3. **Rule Field Structure: `fields` array → `conditions` array**
   - Current: `rules[].fields[]` contains field comparison objects
   - New: `rules[].conditions[]` with explicit operator and side specification
   - **Structure change**: Different property names and semantic

### 4. **Filter Structure Refinement**
   - Current: Optional `values` field for multi-value filtering
   - New: Adds `operator` and `value` fields for single-value filtering
   - **Impact**: Filter application logic in `filters.py` needs to support both patterns

### 5. **Join Keys Naming**
   - Current: `join.keys[].source_field` / `.target_field`
   - New: `join.keys[].source_field` / `.target_field` (unchanged, but source=`left`, target=`right`)
   - **Impact**: Must rename field references in comparator/parser

### 6. **New Features in Schema**
   - `calculated_fields`: Pandas expressions per source (already implemented in code)
   - `source_color`: UI color hint (new)
   - `json_path` & `path`: For nested JSON extraction (already partially supported)
   - Enhanced `record_filter` and `encoding` options

### 7. **Schema Enforces Stricter Validation**
   - XLSX requires `sheet_name` (conditional validation)
   - Fixed-width requires `column_positions`
   - Rules require `conditions` (not optional `fields`)
   - Additional properties are forbidden (`additionalProperties: false`)

---

## Migration Scope

### **Phase 1: Schema Validation Layer**
- [ ] Create JSON schema validator module (`schema_validator.py`)
- [ ] Add JSON schema validation to `config_loader.py` (load from src/schema.json)
- [ ] Keep YAML parsing (convert YAML → JSON internally)
- [ ] Support both old YAML variable names and new JSON names during transition

### **Phase 2: Config Loader Refactoring**
- [ ] Update `config_loader.py` to normalize config after loading (rename keys: `reference`→`left`, `target`→`right`)
- [ ] Add mapping layer for backward compatibility with old YAML configs
- [ ] Validate rule_type values and structure

### **Phase 3: Code Updates by Module**
- [ ] `parser.py`: Reference `config["sources"]["left"]` and `["right"]`
- [ ] `comparator.py`: Update rule evaluation logic for `OK`/`KO` semantics; map `conditions` structure
- [ ] `filters.py`: Handle new operator/value structure
- [ ] `server.py`: Update config loading and audit flow
- [ ] `normalizer.py`: Check for field reference updates
- [ ] `calculator.py`: Verify compatibility with new structure

### **Phase 4: UI Migration** 🎨
- [ ] Audit `index.html` for hardcoded reference/target references
- [ ] Migrate UI source naming (reference → left, target → right)
- [ ] Update rule display for new `conditions[]` structure
- [ ] Update filter display for new operator/value pattern
- [ ] Update modal and preview label references
- [ ] Ensure wizard step labels are dynamic (left/right)
- [ ] Add source color display from schema
- [ ] Audit `static/` assets (favicon.svg, style.css)
- [ ] Check JavaScript wizard state management
- [ ] Verify responsive design with new label lengths

### **Phase 5: Integration & Validation** ✅
- [ ] Create test config in new JSON schema format
- [ ] Add schema validation tests (JSON only)
- [ ] Test UI with JSON schema config
- [ ] End-to-end integration audit test
- [ ] Verify JSON idempotence (load → save byte-identical)

### **Phase 6: Documentation & Release** 📚
- [ ] Update docs/specifications.md with new schema
- [ ] Add migration guide for users (YAML → JSON schema)
- [ ] Update usermanual.md with new config structure and UI changes
- [ ] Bump version and create GitHub release

---

## Idempotence Constraint ⚠️ **CRITICAL**

**JSON config load/save must be byte-identical idempotent:**
```
Load JSON → Normalize internally → Save JSON = Original JSON (byte-for-byte)
```

This means:
- **NO format conversion** — JSON only (no YAML support)
- **Field order preserved** in serialized JSON output
- **Spacing, newlines, indentation** preserved exactly as-is
- **No YAML backward compatibility** — users must use JSON Schema format
- **Normalization is internal only**: normalized representation used internally, serialized back to original JSON exactly

**Implementation approach:**
1. **Input**: Accept JSON only (reject YAML)
2. **Normalize**: Create internal normalized copy (`left`, `right`, `conditions`)
3. **Validate**: Check normalized copy against JSON schema
4. **Apply Logic**: Use normalized config internally
5. **Serialize**: Write JSON back with original field names, order, and formatting preserved
6. **Guarantee**: JSON input = JSON output (byte-identical)

---

## Migration Strategy — JSON Schema Only

### **No Backward Compatibility**
- YAML configs are **NOT** supported in new version
- All users must convert existing YAML to JSON schema format
- Migration tool or guide may be provided separately if needed

### **Affected Modules** (in dependency order)
1. `config_loader.py` — Entry point: JSON only, no YAML support
2. `schema_validator.py` — New module for JSON schema validation
3. `parser.py` — Reads from normalized config
4. `comparator.py` — Core rule evaluation (logic change)
5. `filters.py` — Filter application
6. `server.py` — Orchestration, accept JSON config only
7. `normalizer.py`, `calculator.py`, `unpivot.py` — Update source references
8. `index.html` — UI for JSON schema config (left/right semantics)

### **Test Coverage**
- Unit: Schema validation, normalization, rule evaluation
- Integration: End-to-end audit with new config structure
- Regression: Existing YAML configs still work

---

## Todo Tracking
See SQL todos table for detailed task breakdown and dependencies.

## Notes
- JSON schema file exists at `src/schema.json` (v1.0.0)
- Current code heavily uses YAML tuple unpacking; normalization layer will make transition smooth
- `rule_type` change (`coherence`→`OK`, `incoherence`→`KO`) is the most logic-heavy change
- Consider validator library: `jsonschema` (Python standard for JSON Schema validation)
