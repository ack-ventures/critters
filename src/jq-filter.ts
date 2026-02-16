// Embedded copy of stream-filter.jq for standalone binary usage
export const STREAM_FILTER = `# Pretty-print Claude stream-json events
# Event types: system, assistant, user, result

# Extract short model name
def short_model:
  if test("haiku") then "haiku"
  elif test("opus") then "opus"
  elif test("sonnet") then "sonnet"
  else split("-") | first
  end;

if .type == "system" and .subtype == "init" then
  "\\u001b[2m\\u2699 " + .model + "\\u001b[0m"

elif .type == "assistant" then
  (.parent_tool_use_id != null) as $sub |
  (.message.model // "" | short_model) as $model |
  (if $sub then "\\u001b[2;35m[\\($model)]\\u001b[0m " else "" end) as $tag |
  [.message.content[]? |
    if .type == "text" and (.text | gsub("\\\\s"; "") | length > 0) then
      (if $sub then "\\u001b[2m  " + $tag + .text + "\\u001b[0m" else .text end)
    elif .type == "tool_use" then
      (if $sub then "  " + $tag else "" end) +
      "\\u001b[36m\\u2192 " + .name +
      (if .name == "Read" or .name == "Write" or .name == "Edit" then
        " " + (.input.file_path // "")
      elif .name == "Bash" then
        " $ " + (.input.command // "")
      elif .name == "Glob" then
        " " + (.input.pattern // "") + (if .input.path then " in " + .input.path else "" end)
      elif .name == "Grep" then
        " /" + (.input.pattern // "") + "/" + (if .input.path then " in " + .input.path else "" end)
      elif .name == "Task" then
        " (" + (.input.description // "") + ")"
      else "" end) +
      "\\u001b[0m"
    else empty end
  ] | join("\\n") | select(length > 0)

elif .type == "user" then
  (.parent_tool_use_id != null) as $sub |
  # Only process tool_use_result if it's an object (not a string)
  if (.tool_use_result | type) == "object" then
    # Show Bash command output (stdout + stderr)
    if .tool_use_result.stdout or .tool_use_result.stderr then
      [(if ((.tool_use_result.stdout // "") | length) > 0 then
        (if $sub then "  " else "" end) +
        "\\u001b[2m" +
        (.tool_use_result.stdout | split("\\n") | map(select(length > 0)) |
          if length > 10 then .[0:10] + ["  ... (" + (length | tostring) + " lines total)"]
          else . end | join("\\n" + (if $sub then "  " else "" end))) +
        "\\u001b[0m"
      else empty end),
      (if ((.tool_use_result.stderr // "") | length) > 0 then
        (if $sub then "  " else "" end) +
        "\\u001b[31m" +
        (.tool_use_result.stderr | split("\\n") | map(select(length > 0)) |
          if length > 10 then .[0:10] + ["  ... (" + (length | tostring) + " lines total)"]
          else . end | join("\\n" + (if $sub then "  " else "" end))) +
        "\\u001b[0m"
      else empty end)] | join("\\n") | select(length > 0)
    # Show file write confirmations
    elif .tool_use_result.type == "create" then
      (if $sub then "  " else "" end) +
      "\\u001b[2m\\u2713 Created " + (.tool_use_result.filePath // "") + "\\u001b[0m"
    # Show subagent completion summaries
    elif .tool_use_result.status == "completed" then
      (if $sub then "  " else "" end) +
      "\\u001b[2m\\u2713 Subagent done (" + (.tool_use_result.totalTokens // 0 | tostring) + " tokens)\\u001b[0m"
    else empty end
  # Show tool errors from message content
  elif [.message.content[]? | select(.type == "tool_result" and .is_error == true)] | length > 0 then
    (if $sub then "  " else "" end) +
    "\\u001b[31m\\u2717 " +
    ([.message.content[]? | select(.type == "tool_result" and .is_error == true) | .content // "error"] | join(", ") | .[:200]) +
    "\\u001b[0m"
  else empty end

elif .type == "result" then
  "\\n\\u001b[1;32m\\u2713 Done\\u001b[0m"

else empty end`;
