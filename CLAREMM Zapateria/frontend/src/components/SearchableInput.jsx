import React, { useId } from 'react';

export default function SearchableInput({
  value,
  onChange,
  options = [],
  title = 'Escribe para buscar una opción o captura un valor nuevo.',
  ...inputProps
}) {
  const generatedId = useId();
  const listId = `search-options-${generatedId.replace(/:/g, '')}`;

  return (
    <>
      <input
        {...inputProps}
        list={listId}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        title={title}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </>
  );
}
