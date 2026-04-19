import { useEffect, useState } from "react";
import { RotateCcw, Send } from "lucide-react";

import type { CommandDefinition, CommandResponse } from "../../shared/types";
import {
  colorToDecimal,
  describeResponse,
  guessValues
} from "../lib/deviceMath";

interface CommandExplorerProps {
  commands: CommandDefinition[];
  results: Record<string, CommandResponse>;
  query: string;
  busy: boolean;
  onRead: (command: string) => Promise<void>;
  onWrite: (command: string, values: string[]) => Promise<void>;
}

function CommandRow({
  command,
  result,
  busy,
  onRead,
  onWrite
}: {
  command: CommandDefinition;
  result?: CommandResponse;
  busy: boolean;
  onRead: (command: string) => Promise<void>;
  onWrite: (command: string, values: string[]) => Promise<void>;
}) {
  const [values, setValues] = useState<string[]>(() =>
    guessValues(command, result)
  );
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setValues(guessValues(command, result));
    }
  }, [command, result, touched]);

  function updateValue(index: number, nextValue: string) {
    setTouched(true);
    setValues((current) =>
      current.map((value, currentIndex) =>
        currentIndex === index ? nextValue : value
      )
    );
  }

  async function handleSubmit() {
    const payload =
      command.suggestedControl === "color"
        ? [colorToDecimal(values[0] || "#000000")]
        : command.name.includes("COLOR")
          ? values.map((value) =>
              value.startsWith("#") ? colorToDecimal(value) : value
            )
          : values;
    await onWrite(command.name, payload);
    setTouched(false);
  }

  return (
    <article className="command-row">
      <header className="command-row__header">
        <div>
          <h4>{command.name}</h4>
          <p>{command.description}</p>
        </div>
        <div className="command-row__meta">
          <span>{command.access}</span>
          <span>{command.valueType}</span>
          <span>{command.count}</span>
        </div>
      </header>

      <div className="command-row__value">
        <p>{describeResponse(result)}</p>
      </div>

      <div className="command-row__actions">
        {command.access !== "wo" ? (
          <button
            type="button"
            className="ghost-button"
            disabled={busy}
            onClick={() => void onRead(command.name)}
          >
            <RotateCcw size={14} />
            Read
          </button>
        ) : null}

        {command.access !== "ro" ? (
          <>
            <div className="command-row__editor">
              {Array.from({ length: command.count }).map((_, index) => {
                const optionList = command.options ?? [];
                const isColor =
                  command.suggestedControl === "color" ||
                  command.name.includes("COLOR");

                if (optionList.length > 0 && command.count === 1) {
                  return (
                    <select
                      key={`${command.name}-${index}`}
                      value={values[index] ?? ""}
                      onChange={(event) => updateValue(index, event.target.value)}
                    >
                      {optionList.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  );
                }

                if (command.suggestedControl === "toggle" && command.count === 1) {
                  return (
                    <select
                      key={`${command.name}-${index}`}
                      value={values[index] ?? "0"}
                      onChange={(event) => updateValue(index, event.target.value)}
                    >
                      <option value="0">Off / 0</option>
                      <option value="1">On / 1</option>
                    </select>
                  );
                }

                return (
                  <input
                    key={`${command.name}-${index}`}
                    type={
                      isColor
                        ? "color"
                        : command.suggestedControl === "text"
                          ? "text"
                          : "number"
                    }
                    step={
                      command.range?.step ??
                      (command.valueType === "float" || command.valueType === "radians"
                        ? "0.01"
                        : "1")
                    }
                    min={command.range?.min}
                    max={command.range?.max}
                    value={values[index] ?? ""}
                    onChange={(event) => updateValue(index, event.target.value)}
                  />
                );
              })}
            </div>

            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void handleSubmit()}
            >
              <Send size={14} />
              Write
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

export default function CommandExplorer({
  commands,
  results,
  query,
  busy,
  onRead,
  onWrite
}: CommandExplorerProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = commands.filter((command) => {
    if (!normalizedQuery) {
      return true;
    }

    return command.keywords.some((keyword) =>
      keyword.toLowerCase().includes(normalizedQuery)
    );
  });

  const grouped = filtered.reduce<Record<string, CommandDefinition[]>>(
    (groups, command) => {
      groups[command.group] ??= [];
      groups[command.group].push(command);
      return groups;
    },
    {}
  );

  return (
    <div className="command-explorer">
      {Object.entries(grouped).map(([group, groupCommands]) => (
        <details key={group} className="command-group" open>
          <summary>
            <span>{group}</span>
            <span>{groupCommands.length} commands</span>
          </summary>
          <div className="command-group__body">
            {groupCommands.map((command) => (
              <CommandRow
                key={command.name}
                command={command}
                result={results[command.name]}
                busy={busy}
                onRead={onRead}
                onWrite={onWrite}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
