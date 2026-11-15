// Ghidra headless exporter for the LeanRea normalized function-index schema.
// Exports direct static call references only; indirect/dynamic dispatch remains unknown.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceManager;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class ExportGameFunctionIndex extends GhidraScript {
    private String quote(String value) {
        if (value == null) return "null";
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '"') out.append("\\\"");
            else if (c == '\\') out.append("\\\\");
            else if (c == '\n') out.append("\\n");
            else if (c == '\r') out.append("\\r");
            else if (c == '\t') out.append("\\t");
            else if (c < 0x20) out.append(String.format("\\u%04x", (int)c));
            else out.append(c);
        }
        return out.append('"').toString();
    }

    private String functionId(Function function) {
        return "fn@" + function.getEntryPoint().toString();
    }

    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) throw new IllegalArgumentException("Usage: -postScript ExportGameFunctionIndex.java <output.json>");
        File output = new File(args[0]).getCanonicalFile();
        if (output.exists()) throw new IllegalStateException("Refusing to overwrite function index: " + output);
        File parent = output.getParentFile();
        if (parent != null) Files.createDirectories(parent.toPath());

        List<Function> functions = new ArrayList<>();
        FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
        while (iterator.hasNext()) functions.add(iterator.next());

        ReferenceManager references = currentProgram.getReferenceManager();
        Set<String> seenEdges = new HashSet<>();
        Map<String, Function> externalFunctions = new LinkedHashMap<>();
        List<String> edges = new ArrayList<>();
        for (Function caller : functions) {
            if (caller.isExternal()) continue;
            InstructionIterator instructions = currentProgram.getListing().getInstructions(caller.getBody(), true);
            while (instructions.hasNext()) {
                Instruction instruction = instructions.next();
                Reference[] refs = references.getReferencesFrom(instruction.getAddress());
                for (Reference ref : refs) {
                    if (!ref.getReferenceType().isCall()) continue;
                    Address destination = ref.getToAddress();
                    Function target = currentProgram.getFunctionManager().getFunctionAt(destination);
                    if (target == null) target = currentProgram.getFunctionManager().getFunctionContaining(destination);
                    String to;
                    boolean resolved = target != null;
                    if (target != null && target.isExternal()) {
                        to = "ext@" + target.getEntryPoint().toString();
                        externalFunctions.putIfAbsent(to, target);
                    } else if (target != null) to = functionId(target);
                    else to = "unresolved@" + destination.toString();
                    String edgeKey = functionId(caller) + "|" + to;
                    if (!seenEdges.add(edgeKey)) continue;
                    String edge = "    {\"from\":" + quote(functionId(caller))
                        + ",\"to\":" + quote(to)
                        + ",\"kind\":\"static\",\"confidence\":" + quote(resolved ? "confirmed" : "candidate")
                        + ",\"evidenceRef\":" + quote(instruction.getAddress().toString() + " -> " + destination.toString()) + "}";
                    edges.add(edge);
                }
            }
        }

        StringBuilder json = new StringBuilder(1024 * 128);
        json.append("{\n  \"schemaVersion\": 1,\n");
        String gameId = currentProgram.getName().replaceAll("[^A-Za-z0-9_-]", "-");
        json.append("  \"gameId\": ").append(quote(gameId)).append(",\n");
        json.append("  \"sourceBuild\": \"unverified\",\n");
        json.append("  \"sources\": [{\"id\":\"ghidra-program\",\"path\":")
            .append(quote(currentProgram.getName())).append(",\"tool\":\"Ghidra\"}],\n");
        json.append("  \"entryPoints\": [],\n  \"functions\": [\n");
        List<String> functionRecords = new ArrayList<>();
        for (int i = 0; i < functions.size(); i++) {
            Function function = functions.get(i);
            functionRecords.add("    {\"id\":" + quote(functionId(function))
                + ",\"name\":" + quote(function.getName())
                + ",\"address\":" + quote(function.getEntryPoint().toString())
                + ",\"module\":" + quote(currentProgram.getName())
                + ",\"external\":false,\"evidenceKind\":\"static\"}");
        }
        for (Map.Entry<String, Function> entry : externalFunctions.entrySet()) {
            Function function = entry.getValue();
            functionRecords.add("    {\"id\":" + quote(entry.getKey())
                + ",\"name\":" + quote(function.getName())
                + ",\"address\":" + quote(function.getEntryPoint().toString())
                + ",\"module\":" + quote(currentProgram.getName())
                + ",\"external\":true,\"evidenceKind\":\"static\"}");
        }
        for (int i = 0; i < functionRecords.size(); i++) json.append(functionRecords.get(i)).append(i + 1 == functionRecords.size() ? "\n" : ",\n");
        json.append("  ],\n  \"calls\": [\n");
        for (int i = 0; i < edges.size(); i++) {
            json.append(edges.get(i)).append(i + 1 == edges.size() ? "\n" : ",\n");
        }
        json.append("  ]\n}\n");
        Files.write(output.toPath(), json.toString().getBytes(StandardCharsets.UTF_8));
        println("Exported " + functionRecords.size() + " functions (" + externalFunctions.size() + " external symbols) and " + edges.size() + " direct call edges to " + output);
        println("Indirect calls, virtual dispatch and runtime-only edges are not inferred by this exporter.");
    }
}
