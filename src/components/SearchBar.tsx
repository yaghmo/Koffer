interface Props {
  value: string;
  onChange: (v: string) => void;
}

export default function SearchBar({ value, onChange }: Props) {
  return (
    <input
      type="text"
      placeholder="Search…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="search"
    />
  );
}
