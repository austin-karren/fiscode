import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@fiscode/ui/components/combobox";

import { US_STATES, US_STATE_BY_CODE } from "../../lib/us-states";

type StateOption = { code: string; name: string };

// Typeahead combobox for US state of residence. Stores the IRS-style
// two-letter code (e.g. "UT") but displays the full state name in the
// input and lets the user search by either.
//
// `value` is the empty string when nothing is picked; a 2-letter code
// otherwise.
export function StateCombobox({
  value,
  onValueChange,
  placeholder = "Pick a state…",
}: {
  value: string;
  onValueChange: (code: string) => void;
  placeholder?: string;
}) {
  return (
    <Combobox
      items={US_STATES}
      itemToStringLabel={(s: StateOption) => s.name}
      itemToStringValue={(s: StateOption) => s.code}
      value={value ? (US_STATES.find((s) => s.code === value) ?? null) : null}
      onValueChange={(s) => onValueChange(s ? (s as StateOption).code : "")}
    >
      <ComboboxInput placeholder={placeholder} showClear={value !== ""} />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>No matching state.</ComboboxEmpty>
          <ComboboxCollection>
            {(s: StateOption) => (
              <ComboboxItem key={s.code} value={s}>
                <span className="flex-1">{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export { US_STATE_BY_CODE };
