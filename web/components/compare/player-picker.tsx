'use client';

import { CaretDownIcon, XIcon } from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';

import { lineOf, playersByLine, type PlayerPosition } from '@/lib/compare/compare';
import type { PlayerRow } from '@/lib/stats/catalog';

interface PlayerPickerProps {
  label: string;
  players: readonly PlayerRow[];
  positions: ReadonlyMap<number, PlayerPosition>;
  value: number | null;
  onChange: (playerId: number | null) => void;
  /** Jugadores que no se ofrecen (por ejemplo, el principal en «otro jugador»). */
  exclude?: readonly number[];
  placeholder?: string;
  /** Color del jugador en los gráficos (variable --series-N), para la muestra junto al nombre. */
  slot?: number;
}

/**
 * Selector de jugador con búsqueda en el mismo control (combobox): se escribe el nombre (sin
 * importar tildes ni mayúsculas) y la lista muestra los jugadores agrupados por línea, de más a
 * menos minutos. Flechas, Enter y Escape funcionan como en cualquier lista.
 */
export function PlayerPicker({
  label,
  players,
  positions,
  value,
  onChange,
  exclude = [],
  placeholder = 'Buscá un jugador',
  slot,
}: PlayerPickerProps) {
  const id = useId();
  const listId = `${id}-lista`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = players.find((p) => p.playerId === value) ?? null;
  const groups = useMemo(
    () =>
      playersByLine(
        players.filter((p) => !exclude.includes(p.playerId)),
        positions,
        query,
      ),
    [players, positions, query, exclude],
  );
  const flat = groups.flatMap((g) => g.players);
  const indexOf = new Map(flat.map((p, i) => [p.playerId, i]));

  const choose = (p: PlayerRow) => {
    onChange(p.playerId);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (flat.length ? (i + step + flat.length) % flat.length : 0));
    } else if (e.key === 'Enter') {
      const p = flat[active];
      if (open && p) {
        e.preventDefault();
        choose(p);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="picker">
      <label htmlFor={`${id}-input`} className="sr-only">
        {label}
      </label>
      <div className="picker__field">
        {slot ? (
          <span
            className="chart-key chart-key--box"
            style={{ background: `var(--series-${String(slot)})` }}
            aria-hidden="true"
          />
        ) : null}
        <input
          ref={inputRef}
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && flat[active] ? `${id}-op-${String(flat[active].playerId)}` : undefined}
          autoComplete="off"
          className="picker__input"
          placeholder={selected ? selected.name : placeholder}
          value={open ? query : selected ? selected.name : ''}
          onFocus={() => {
            setOpen(true);
            setActive(0);
          }}
          onBlur={() => {
            // Deja terminar el clic sobre una opción antes de cerrar.
            setTimeout(() => {
              setOpen(false);
              setQuery('');
            }, 120);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {selected ? (
          <button
            type="button"
            className="picker__clear focus-ring"
            aria-label={`Quitar ${selected.name}`}
            onClick={() => {
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        ) : (
          <CaretDownIcon size={14} aria-hidden="true" className="picker__caret" />
        )}
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="picker__list">
          {groups.length === 0 ? <li className="picker__empty">Ningún jugador con ese nombre.</li> : null}
          {groups.map((g) => (
            <li key={g.line} role="presentation">
              <p className="picker__group" aria-hidden="true">
                {g.line}
              </p>
              <ul role="group" aria-label={g.line}>
                {g.players.map((p) => {
                  const i = indexOf.get(p.playerId) ?? 0;
                  return (
                    <li
                      key={p.playerId}
                      id={`${id}-op-${String(p.playerId)}`}
                      role="option"
                      aria-selected={p.playerId === value}
                      className={`picker__option${i === active ? ' picker__option--active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(p);
                      }}
                      onMouseEnter={() => {
                        setActive(i);
                      }}
                    >
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-xs text-muted">
                        {lineOf(p, positions.get(p.playerId)) ?? 'n/d'}
                        {positions.get(p.playerId)?.role ? ` · ${positions.get(p.playerId)?.role ?? ''}` : ''} ·{' '}
                        {p.minutes} min
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
