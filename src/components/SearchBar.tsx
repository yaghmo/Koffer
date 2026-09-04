import { SearchIcon } from "./Icon";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SearchBar({ value, onChange }: Props) {
  return (
    <label className="search">
      <SearchIcon />
      <input
        type="text"
        placeholder="Search…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}
