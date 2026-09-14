import { SearchIcon } from "./Icon";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SearchBar({ value, onChange }: Props) {
  return (
    <label
      htmlFor="vault-search"
      className="flex h-11 flex-1 items-center gap-2 rounded-control border border-white/8 bg-surface-container-lowest px-3 transition-colors duration-150 ease-out focus-within:border-primary-container"
    >
      <SearchIcon size={16} className="text-outline" />
      <input
        id="vault-search"
        type="text"
        placeholder="Search items"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 bg-transparent text-body-md text-on-surface outline-none placeholder:text-outline"
      />
      <kbd className="label-md rounded-chip border border-white/8 px-1.5 py-0.5">Ctrl K</kbd>
    </label>
  );
}
