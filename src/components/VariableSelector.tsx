import { VARIABLES, type VariableId } from '../config/models';

interface Props {
  selected: VariableId;
  onChange: (v: VariableId) => void;
}

export function VariableSelector({ selected, onChange }: Props) {
  return (
    <div className="variable-selector">
      {VARIABLES.map((v) => (
        <button
          key={v.id}
          className={`var-btn ${selected === v.id ? 'active' : ''}`}
          onClick={() => onChange(v.id)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
