import resaver.ess.ESS;
import resaver.ess.ModelBuilder;
import resaver.ess.RefID;
import resaver.ess.Plugin;
import resaver.ess.Element;
import resaver.ess.ChangeForm;
import resaver.ess.GlobalVariable;
import resaver.ProgressModel;
import resaver.ess.papyrus.*;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/**
 * ResaverCLI — headless driver for ReSaver's (FallrimTools) save library. JSON on stdout.
 * Usage: ResaverCLI <op> <save.ess> [args...]
 *   info       <save>
 *   dump       <save> <subsystem> [--limit N] [--undefined-only] [--script <name>] [--type <T>]
 *              subsystem: scriptinstances|activescripts|references|structinstances|scripts|globals|changeforms
 *   find-refs  <save> <eidHex>                 who references this element (direct + secondary, labeled)
 *   find       <save> <query>                  query = <Plugin.esp:formid> | <formidHex> | <script-name substring>
 *   worries    <save>                          ReSaver's Worrier problem report
 *   set-global <save> <target> <value> [<out.ess>] [--apply]   target = formidHex | Plugin.esp:formid
 *   set-var    <save> <eidHex> [<index> <value> <out.ess>] [--type int|float|bool|str] [--apply]
 *   clean      <save> <out.ess> [--undefined] [--unattached] [--terminate-threads] [--apply]
 *
 * Writes NEVER overwrite the input; dry-run unless --apply; output goes to a NEW file.
 */
public class ResaverCLI {

    public static void main(String[] args) {
        java.util.logging.Logger.getLogger("").setLevel(java.util.logging.Level.SEVERE);
        try {
            if (args.length < 2) { err("need <op> <save> [...]"); return; }
            String op = args[0];
            Path save = Paths.get(args[1]);
            ESS.Result result = ESS.readESS(save, new ModelBuilder(new ProgressModel(1)));
            ESS ess = result.ESS;
            Papyrus pap = ess.getPapyrus();
            PapyrusContext ctx = pap.getContext();

            switch (op) {
                case "info":       info(ess, pap); break;
                case "dump":       dump(ess, pap, ctx, args); break;
                case "find-refs":  findRefs(ess, pap, ctx, arg(args, 2, null)); break;
                case "find":       find(ess, pap, ctx, arg(args, 2, null)); break;
                case "worries":    worries(result); break;
                case "set-global": setGlobal(ess, args); break;
                case "set-var":    setVar(ess, pap, ctx, args); break;
                case "clean":      clean(ess, pap, save, args); break;
                default: err("unknown op: " + op);
            }
        } catch (Throwable t) {
            System.out.println("{\"ok\":false,\"error\":" + jstr(t.toString()) + "}");
            t.printStackTrace(System.err);
        }
    }

    // ---------- info ----------

    static void info(ESS ess, Papyrus pap) {
        int[] undef = pap.countUndefinedElements();
        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"info\"");
        kv(b, "game", ess.getHeader().GAME.toString());
        kvn(b, "changeForms", ess.getChangeForms().size());
        kvn(b, "scriptInstances", pap.getScriptInstances().size());
        kvn(b, "scripts", pap.getScripts().size());
        kvn(b, "references", pap.getReferences().size());
        kvn(b, "structInstances", pap.getStructInstances().size());
        kvn(b, "arrays", pap.getArrays().size());
        kvn(b, "activeScripts", pap.getActiveScripts().size());
        kvn(b, "suspendedStacks", pap.getSuspendedStacks().size());
        kvn(b, "unbinds", pap.getUnbinds().size());
        kvn(b, "functionMessages", pap.getFunctionMessages().size());
        // [0] = undefined Scripts+ScriptInstances+References+Structs+StructInstances; [1] = undefined non-terminated threads
        kvn(b, "undefinedElements", undef.length > 0 ? undef[0] : -1);
        kvn(b, "undefinedThreads", undef.length > 1 ? undef[1] : -1);
        kvn(b, "unattachedInstances", pap.countUnattachedInstances());
        b.append("}");
        System.out.println(b);
    }

    // ---------- dump ----------

    static void dump(ESS ess, Papyrus pap, PapyrusContext ctx, String[] args) {
        String sub = arg(args, 2, "scriptinstances");
        int limit = flagVal(args, "--limit") != null ? Integer.parseInt(flagVal(args, "--limit")) : Integer.MAX_VALUE;
        boolean undefOnly = has(args, "--undefined-only");
        String scriptFilter = flagVal(args, "--script");
        String typeFilter = flagVal(args, "--type");
        String sf = scriptFilter == null ? null : scriptFilter.toLowerCase();

        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"dump\",\"subsystem\":").append(jstr(sub)).append(",\"items\":[");
        int n = 0;
        switch (sub.toLowerCase()) {
            case "scriptinstances":
                for (ScriptInstance si : pap.getScriptInstances().values()) {
                    if (undefOnly && !si.isUndefined()) continue;
                    if (sf != null && (si.getScript() == null || !str(si.getScript().getName()).toLowerCase().contains(sf))) continue;
                    if (n >= limit) break;
                    if (n++ > 0) b.append(","); b.append(siJson(si));
                }
                break;
            case "activescripts":
                for (ActiveScript a : pap.getActiveScripts().values()) {
                    if (undefOnly && !a.isUndefined()) continue;
                    if (n >= limit) break;
                    if (n++ > 0) b.append(",");
                    b.append("{\"id\":").append(jstr(str(a.getID())))
                     .append(",\"undefined\":").append(a.isUndefined())
                     .append(",\"terminated\":").append(a.isTerminated())
                     .append(",\"attached\":").append(jstr(str(a.getAttachedElement()))).append("}");
                }
                break;
            case "references":
                for (Reference r : pap.getReferences().values()) {
                    if (undefOnly && !r.isUndefined()) continue;
                    if (sf != null && (r.getScript() == null || !str(r.getScript().getName()).toLowerCase().contains(sf))) continue;
                    if (n >= limit) break;
                    if (n++ > 0) b.append(",");
                    b.append("{\"id\":").append(jstr(str(r.getID())))
                     .append(",\"script\":").append(jstr(r.getScript()==null?null:str(r.getScript().getName())))
                     .append(",\"undefined\":").append(r.isUndefined())
                     .append(",\"vars\":").append(r.getVariables().size()).append("}");
                }
                break;
            case "structinstances":
                for (StructInstance s : pap.getStructInstances().values()) {
                    if (undefOnly && !s.isUndefined()) continue;
                    if (n >= limit) break;
                    if (n++ > 0) b.append(",");
                    b.append("{\"id\":").append(jstr(str(s.getID())))
                     .append(",\"struct\":").append(jstr(s.getStruct()==null?null:str(s.getStruct().getName())))
                     .append(",\"undefined\":").append(s.isUndefined()).append("}");
                }
                break;
            case "scripts":
                for (Script s : pap.getScripts().values()) {
                    if (undefOnly && !s.isUndefined()) continue;
                    if (sf != null && !str(s.getName()).toLowerCase().contains(sf)) continue;
                    if (n >= limit) break;
                    if (n++ > 0) b.append(",");
                    b.append("{\"name\":").append(jstr(str(s.getName())))
                     .append(",\"undefined\":").append(s.isUndefined())
                     .append(",\"members\":").append(s.getMembers()==null?0:s.getMembers().size()).append("}");
                }
                break;
            case "globals":
                for (GlobalVariable g : ess.getGlobals().getVariables()) {
                    if (n >= limit) break;
                    if (n++ > 0) b.append(",");
                    b.append("{\"global\":").append(jstr(str(g)))
                     .append(",\"value\":").append(g.getValue()).append("}");
                }
                break;
            case "changeforms":
                for (ChangeForm cf : ess.getChangeForms()) {
                    String t = str(cf.getType());
                    if (typeFilter != null && (t == null || !t.equalsIgnoreCase(typeFilter))) continue;
                    if (n >= limit) break;
                    if (n++ > 0) b.append(",");
                    b.append("{\"refid\":").append(jstr(refStr(cf.getRefID())))
                     .append(",\"type\":").append(jstr(t))
                     .append(",\"version\":").append(cf.getVersion())
                     .append(",\"compressed\":").append(cf.isCompressed()).append("}");
                }
                break;
            default:
                b.append("]}"); System.out.println(b); err("unknown subsystem: " + sub); return;
        }
        b.append("],\"count\":").append(n);
        if (n >= limit) b.append(",\"truncated\":true");
        b.append("}");
        System.out.println(b);
    }

    // ---------- find-refs (direct + secondary, labeled) ----------

    static void findRefs(ESS ess, Papyrus pap, PapyrusContext ctx, String eidHex) {
        if (eidHex == null) { err("find-refs needs <eidHex>"); return; }
        HasID target = resolveEID(pap, ctx, eidHex);
        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"find-refs\",\"target\":").append(jstr(eidHex));
        if (target == null) { b.append(",\"found\":false}"); System.out.println(b); return; }
        b.append(",\"found\":true,\"targetType\":").append(jstr(target.getClass().getSimpleName()))
         .append(",\"targetDesc\":").append(jstr(str(target)));

        Set<Element> direct = directReferrers(pap, (Element) target);
        List<DefinedElement> all = ctx.findReferees((Element) target);  // direct + secondary (2-hop)
        int directCount = 0, secondaryCount = 0;
        b.append(",\"referees\":[");
        int n = 0;
        for (DefinedElement de : all) {
            boolean isDirect = direct.contains(de);
            if (isDirect) directCount++; else secondaryCount++;
            if (n++ > 0) b.append(",");
            b.append("{\"relation\":").append(isDirect ? "\"direct\"" : "\"secondary\"")
             .append(",\"type\":").append(jstr(de.getClass().getSimpleName()))
             .append(",\"desc\":").append(jstr(str(de))).append("}");
        }
        b.append("],\"refereeCount\":").append(n)
         .append(",\"directCount\":").append(directCount)
         .append(",\"secondaryCount\":").append(secondaryCount).append("}");
        System.out.println(b);
    }

    static Set<Element> directReferrers(Papyrus pap, Element target) {
        Set<Element> direct = new HashSet<>();
        for (ScriptInstance si : pap.getScriptInstances().values()) if (refersTo(si, target)) direct.add(si);
        for (Reference r : pap.getReferences().values())           if (refersTo(r, target))  direct.add(r);
        for (StructInstance s : pap.getStructInstances().values()) if (refersTo(s, target))  direct.add(s);
        for (ActiveScript a : pap.getActiveScripts().values())     if (Objects.equals(target, a.getAttachedElement())) direct.add(a);
        return direct;
    }
    static boolean refersTo(HasVariables hv, Element target) {
        for (Variable v : hv.getVariables()) if (v.hasRef() && Objects.equals(target, v.getReferent())) return true;
        return false;
    }

    // ---------- find (whole-save sweep) ----------

    static void find(ESS ess, Papyrus pap, PapyrusContext ctx, String query) {
        if (query == null) { err("find needs <query>"); return; }
        // Parse "Plugin.es[pml]:formid" | bare formid hex | script-name substring
        String plug = null; Long fid = null;
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("^(.+\\.es[plm]):([0-9a-fA-F]+)$", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(query);
        if (m.matches()) { plug = m.group(1); fid = parseHex(m.group(2)); }
        else if (query.matches("^(0x)?[0-9a-fA-F]{1,8}$")) { fid = parseHex(query); }
        String q = query.toLowerCase();

        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"find\",\"query\":").append(jstr(query));
        b.append(",\"mode\":").append(jstr(fid != null ? (plug != null ? "plugin:formid" : "formid(any-plugin)") : "scriptName"));
        b.append(",\"hits\":[");
        int n = 0;

        for (ScriptInstance si : pap.getScriptInstances().values()) {
            boolean hit = (fid != null) ? refidMatches(si.getRefID(), plug, fid)
                                        : (si.getScript()!=null && str(si.getScript().getName()).toLowerCase().contains(q));
            if (hit) { if (n++>0) b.append(","); b.append("{\"kind\":\"scriptInstance\",").append(siBody(si)).append("}"); }
        }
        if (fid == null) {
            for (Reference r : pap.getReferences().values())
                if (r.getScript()!=null && str(r.getScript().getName()).toLowerCase().contains(q)) {
                    if (n++>0) b.append(","); b.append("{\"kind\":\"reference\",\"id\":").append(jstr(str(r.getID()))).append(",\"script\":").append(jstr(str(r.getScript().getName()))).append("}");
                }
            for (Script s : pap.getScripts().values())
                if (str(s.getName()).toLowerCase().contains(q)) {
                    if (n++>0) b.append(","); b.append("{\"kind\":\"script\",\"name\":").append(jstr(str(s.getName()))).append(",\"undefined\":").append(s.isUndefined()).append("}");
                }
        } else {
            for (ChangeForm cf : ess.getChangeForms())
                if (refidMatches(cf.getRefID(), plug, fid)) {
                    if (n++>0) b.append(","); b.append("{\"kind\":\"changeForm\",\"refid\":").append(jstr(refStr(cf.getRefID()))).append(",\"type\":").append(jstr(str(cf.getType()))).append("}");
                }
        }
        b.append("],\"hitCount\":").append(n).append("}");
        System.out.println(b);
    }

    static boolean refidMatches(RefID r, String plug, Long fid) {
        if (r == null || fid == null) return false;
        if ((r.FORMID & 0xFFFFFF) != (fid.intValue() & 0xFFFFFF)) return false;
        if (plug != null) return r.PLUGIN != null && r.PLUGIN.NAME.equalsIgnoreCase(plug);
        return true;
    }

    // ---------- worries ----------

    static void worries(ESS.Result result) {
        Worrier w = new Worrier(result, Optional.empty());
        String html = w.getMessage().render();
        String text = html.replaceAll("(?i)<br\\s*/?>", "\n").replaceAll("(?i)</(p|div|h1|h2|h3|li|hr)>", "\n")
                          .replaceAll("<[^>]+>", "").replaceAll("&nbsp;", " ").replaceAll("&amp;", "&")
                          .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("\\n{3,}", "\n\n").trim();
        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"worries\"")
         .append(",\"shouldWorry\":").append(w.shouldWorry())
         .append(",\"shouldDisableSaving\":").append(w.shouldDisableSaving())
         .append(",\"reportText\":").append(jstr(text))
         .append(",\"reportHtml\":").append(jstr(html))
         .append("}");
        System.out.println(b);
    }

    // ---------- set-global ----------

    static void setGlobal(ESS ess, String[] args) throws Exception {
        List<String> pos = positionals(args, 2);   // [target, value, out?]
        if (pos.size() < 2) { err("set-global needs <target> <value> [<out.ess>] [--apply]"); return; }
        String target = pos.get(0);
        float newVal = Float.parseFloat(pos.get(1));
        boolean apply = has(args, "--apply");
        String out = pos.size() > 2 ? pos.get(2) : null;

        GlobalVariable match = null;
        for (GlobalVariable g : ess.getGlobals().getVariables()) {
            if (globalMatches(g, target)) { match = g; break; }
        }
        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"set-global\",\"target\":").append(jstr(target)).append(",\"apply\":").append(apply);
        if (match == null) { b.append(",\"found\":false}"); System.out.println(b); return; }
        b.append(",\"found\":true,\"global\":").append(jstr(str(match)))
         .append(",\"oldValue\":").append(match.getValue()).append(",\"newValue\":").append(newVal);
        if (!apply) { b.append(",\"dryRun\":true}"); System.out.println(b); return; }
        if (out == null) { b.append(",\"error\":\"--apply needs <out.ess>\"}"); System.out.println(b); return; }
        match.setValue(newVal);
        Path outPath = Paths.get(out);
        ESS.writeESS(ess, outPath, false);
        b.append(",\"out\":").append(jstr(outPath.toString())).append("}");
        System.out.println(b);
    }

    // toString() = "([name] )?PLUGIN:FORMIDHEX = value"; match target = formidHex | Plugin:formid
    static boolean globalMatches(GlobalVariable g, String target) {
        String s = str(g);
        int eq = s.indexOf(" = ");
        if (eq < 0) return false;
        String idTok = s.substring(0, eq).trim();
        int rb = idTok.lastIndexOf("] ");
        if (rb >= 0) idTok = idTok.substring(rb + 2);     // strip "[name] "
        // idTok now "PLUGIN:FORMIDHEX"
        if (target.contains(":")) return idTok.equalsIgnoreCase(target);
        int c = idTok.indexOf(':');
        String fhex = c >= 0 ? idTok.substring(c + 1) : idTok;
        Long a = parseHex(fhex), t = parseHex(target);
        return a != null && t != null && (a.intValue() & 0xFFFFFF) == (t.intValue() & 0xFFFFFF);
    }

    // ---------- set-var (Papyrus instance variable) ----------

    static void setVar(ESS ess, Papyrus pap, PapyrusContext ctx, String[] args) throws Exception {
        List<String> pos = positionals(args, 2);   // [eid] (preview) | [eid, index, value, out?]
        if (pos.isEmpty()) { err("set-var needs <eidHex> [<index> <value> <out.ess>]"); return; }
        String eidHex = pos.get(0);
        HasID target = resolveEID(pap, ctx, eidHex);
        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"set-var\",\"target\":").append(jstr(eidHex));
        if (!(target instanceof HasVariables)) {
            b.append(",\"found\":").append(target != null).append(",\"error\":\"target has no variables\"}");
            System.out.println(b); return;
        }
        HasVariables hv = (HasVariables) target;
        List<Variable> vars = hv.getVariables();
        b.append(",\"found\":true,\"targetType\":").append(jstr(target.getClass().getSimpleName()));

        if (pos.size() < 3) {   // preview mode: list variables
            b.append(",\"preview\":true,\"variables\":[");
            for (int i = 0; i < vars.size(); i++) {
                if (i > 0) b.append(",");
                Variable v = vars.get(i);
                b.append("{\"index\":").append(i).append(",\"type\":").append(jstr(str(v.getType())))
                 .append(",\"value\":").append(jstr(str(v))).append("}");
            }
            b.append("]}"); System.out.println(b); return;
        }

        int index = Integer.parseInt(pos.get(1));
        String val = pos.get(2);
        boolean apply = has(args, "--apply");
        String out = pos.size() > 3 ? pos.get(3) : null;
        if (index < 0 || index >= vars.size()) { b.append(",\"error\":\"index out of range\"}"); System.out.println(b); return; }
        Variable old = vars.get(index);
        String type = flagVal(args, "--type");
        Variable nv = buildVar(old, type, val, ctx);
        if (nv == null) { b.append(",\"error\":\"unsupported var type (primitives int/float/bool/str only)\"}"); System.out.println(b); return; }
        b.append(",\"index\":").append(index).append(",\"oldValue\":").append(jstr(str(old)))
         .append(",\"newValue\":").append(jstr(str(nv))).append(",\"apply\":").append(apply);
        if (!apply) { b.append(",\"dryRun\":true}"); System.out.println(b); return; }
        if (out == null) { b.append(",\"error\":\"--apply needs <out.ess>\"}"); System.out.println(b); return; }
        hv.setVariable(index, nv);
        Path outPath = Paths.get(out);
        ESS.writeESS(ess, outPath, false);
        b.append(",\"out\":").append(jstr(outPath.toString())).append("}");
        System.out.println(b);
    }

    static Variable buildVar(Variable old, String type, String val, PapyrusContext ctx) {
        String t = type != null ? type.toLowerCase()
                 : (old instanceof Variable.Int ? "int" : old instanceof Variable.Flt ? "float"
                  : old instanceof Variable.Bool ? "bool" : old instanceof Variable.Str ? "str" : null);
        if (t == null) return null;
        switch (t) {
            case "int":   return new Variable.Int(Integer.decode(val));
            case "float": return new Variable.Flt(Float.parseFloat(val));
            case "bool":  return new Variable.Bool(val.equals("1") || Boolean.parseBoolean(val));
            case "str":   return new Variable.Str(val, ctx);
            default:      return null;
        }
    }

    // ---------- clean ----------

    static void clean(ESS ess, Papyrus pap, Path inSave, String[] args) throws Exception {
        boolean undef = has(args, "--undefined");
        boolean unatt = has(args, "--unattached");
        boolean term  = has(args, "--terminate-threads");
        boolean apply = has(args, "--apply");
        String out = positionals(args, 2).isEmpty() ? null : positionals(args, 2).get(0);
        if (!undef && !unatt && !term) { err("clean needs at least one of --undefined/--unattached/--terminate-threads"); return; }

        int[] before = pap.countUndefinedElements();
        int unattBefore = pap.countUnattachedInstances();
        StringBuilder b = new StringBuilder();
        b.append("{\"ok\":true,\"op\":\"clean\",\"apply\":").append(apply);
        kvn(b, "undefinedElementsBefore", before.length>0?before[0]:-1);
        kvn(b, "undefinedThreadsBefore", before.length>1?before[1]:-1);
        kvn(b, "unattachedBefore", unattBefore);

        if (!apply) {
            // NOTE: removeUndefinedElements() ALSO zeroes undefined threads internally, so --undefined already
            // covers thread termination; --terminate-threads is only additive if used alone.
            b.append(",\"dryRun\":true,\"wouldRemove\":{");
            b.append("\"undefinedElements\":").append(undef? (before.length>0?before[0]:0):0);
            b.append(",\"undefinedThreads\":").append((undef||term)? (before.length>1?before[1]:0):0);
            b.append(",\"unattached\":").append(unatt? unattBefore:0);
            b.append("},\"note\":\"--undefined also zeroes undefined threads\"}");
            System.out.println(b); return;
        }

        int rUndef=0, rUnatt=0, rTerm=0;
        if (unatt) rUnatt = pap.removeUnattachedInstances().size();
        if (undef) rUndef = pap.removeUndefinedElements().size();
        if (term)  rTerm  = pap.terminateUndefinedThreads().size();
        if (out == null) { err("clean --apply needs <out.ess>"); return; }
        Path outPath = Paths.get(out);
        ESS.writeESS(ess, outPath, false);
        b.append(",\"removedUnattached\":").append(rUnatt)
         .append(",\"removedUndefined\":").append(rUndef)
         .append(",\"terminatedThreads\":").append(rTerm)
         .append(",\"out\":").append(jstr(outPath.toString())).append("}");
        System.out.println(b);
    }

    // ---------- helpers ----------

    static HasID resolveEID(Papyrus pap, PapyrusContext ctx, String hex) {
        Long v = parseHex(hex);
        if (v == null) return null;
        HasID r = ctx.findAny(ctx.makeEID64(v));
        if (r == null) r = ctx.findAny(ctx.makeEID32(v.intValue()));
        return r;
    }

    static String siJson(ScriptInstance si) { return "{" + siBody(si) + "}"; }
    static String siBody(ScriptInstance si) {
        return "\"id\":" + jstr(str(si.getID()))
             + ",\"script\":" + jstr(si.getScript()==null?null:str(si.getScript().getName()))
             + ",\"refid\":" + jstr(refStr(si.getRefID()))
             + ",\"undefined\":" + si.isUndefined()
             + ",\"unattached\":" + si.isUnattached()
             + ",\"vars\":" + si.getVariables().size();
    }

    static String refStr(RefID r) {
        if (r == null) return null;
        String plugin = (r.PLUGIN != null) ? r.PLUGIN.NAME : "?";
        return plugin + ":" + String.format("%06X", r.FORMID & 0xFFFFFF);
    }

    static Long parseHex(String s) {
        if (s == null) return null;
        String t = s.startsWith("0x") || s.startsWith("0X") ? s.substring(2) : s;
        try { return Long.parseUnsignedLong(t, 16); } catch (Exception e) { return null; }
    }

    static String str(Object o) { return o == null ? null : o.toString(); }
    static String arg(String[] a, int i, String def) { return a.length > i ? a[i] : def; }
    static boolean has(String[] a, String flag) { for (String s : a) if (s.equals(flag)) return true; return false; }
    static String flagVal(String[] a, String flag) { for (int i=0;i<a.length-1;i++) if (a[i].equals(flag)) return a[i+1]; return null; }
    static List<String> positionals(String[] a, int from) {
        List<String> p = new ArrayList<>();
        for (int i = from; i < a.length; i++) {
            if (a[i].startsWith("--")) { if (a[i].equals("--type") || a[i].equals("--limit") || a[i].equals("--script")) i++; continue; }
            p.add(a[i]);
        }
        return p;
    }
    static void err(String m) { System.out.println("{\"ok\":false,\"error\":" + jstr(m) + "}"); }
    static void kv(StringBuilder b, String k, String v) { b.append(",\"").append(k).append("\":").append(jstr(v)); }
    static void kvn(StringBuilder b, String k, long v) { b.append(",\"").append(k).append("\":").append(v); }

    static String jstr(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default: if (c < 0x20) b.append(String.format("\\u%04x", (int)c)); else b.append(c);
            }
        }
        return b.append("\"").toString();
    }
}
