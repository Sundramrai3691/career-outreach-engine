import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, Check } from 'lucide-react';
import { api } from '../services/api.js';

export interface ChipOption {
  value: string;
  label: string;
  subtext?: string;
}

interface MultiSelectChipsProps {
  id?: string;
  label?: string;
  placeholder?: string;
  type?: 'companies' | 'roles' | 'locations';
  selected: string[];
  onChange: (selected: string[]) => void;
  maxChips?: number;
  allowCustom?: boolean;
  helperText?: string;
  icon?: React.ReactNode;
}

export const MultiSelectChips: React.FC<MultiSelectChipsProps> = ({
  id,
  label,
  placeholder = 'Type and press Enter...',
  type,
  selected,
  onChange,
  maxChips,
  allowCustom = true,
  helperText,
  icon,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<ChipOption[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch suggestions when query changes or input focused
  useEffect(() => {
    let active = true;
    if (!type || !isDropdownOpen) return;

    const timer = setTimeout(async () => {
      try {
        const res = await api.getSuggestions(type, inputValue.trim());
        if (active) {
          // Filter out already selected values
          const lowerSelected = new Set(selected.map((s) => s.toLowerCase()));
          const filtered = res.suggestions.filter(
            (s) => !lowerSelected.has(s.value.toLowerCase())
          );
          setSuggestions(filtered);
          setHighlightedIndex(filtered.length > 0 ? 0 : -1);
        }
      } catch (err) {
        console.error('Failed to load autocomplete suggestions', err);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [type, inputValue, isDropdownOpen, selected]);

  const addChip = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (maxChips && selected.length >= maxChips) return;

    // Check duplicate case-insensitively
    const exists = selected.some((s) => s.toLowerCase() === trimmed.toLowerCase());
    if (!exists) {
      onChange([...selected, trimmed]);
    }

    setInputValue('');
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };

  const removeChip = (indexToRemove: number) => {
    onChange(selected.filter((_, idx) => idx !== indexToRemove));
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        return;
      }
      if (suggestions.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        return;
      }
      if (suggestions.length > 0) {
        setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isDropdownOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        addChip(suggestions[highlightedIndex].value);
        setIsDropdownOpen(false);
      } else if (inputValue.trim() && allowCustom) {
        addChip(inputValue.trim());
        setIsDropdownOpen(false);
      }
    } else if (e.key === ',') {
      e.preventDefault();
      if (inputValue.trim() && allowCustom) {
        addChip(inputValue.trim());
      }
    } else if (e.key === 'Backspace') {
      if (inputValue === '' && selected.length > 0) {
        e.preventDefault();
        removeChip(selected.length - 1);
      }
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="form-group" ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <label
          htmlFor={id}
          className="form-label"
          style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'space-between' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            {icon}
            {label}
          </span>
          {selected.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              {selected.length} {selected.length === 1 ? 'selected' : 'selected'}
            </span>
          )}
        </label>
      )}

      {/* Chips Container Box */}
      <div
        id={id}
        onClick={() => inputRef.current?.focus()}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.375rem',
          minHeight: '44px',
          padding: '0.375rem 0.625rem',
          background: 'rgba(15, 23, 42, 0.6)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          cursor: 'text',
          transition: 'all var(--transition-fast)',
        }}
      >
        {/* Selected Chips */}
        {selected.map((item, idx) => (
          <span
            key={`${item}-${idx}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.25rem 0.625rem',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(139, 92, 246, 0.2) 100%)',
              border: '1px solid rgba(129, 140, 248, 0.4)',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: '#e0e7ff',
              lineHeight: 1.2,
            }}
          >
            <span>{item}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeChip(idx);
              }}
              aria-label={`Remove ${item}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                color: '#a5b4fc',
                cursor: 'pointer',
                padding: '0',
                marginLeft: '0.125rem',
                borderRadius: '50%',
              }}
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {/* Text Input */}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsDropdownOpen(true);
          }}
          onFocus={() => setIsDropdownOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : 'Add more...'}
          style={{
            flex: 1,
            minWidth: '130px',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: '0.875rem',
            padding: '0.25rem 0.25rem',
          }}
        />

        {type && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsDropdownOpen(!isDropdownOpen);
              inputRef.current?.focus();
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>

      {helperText && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', marginBottom: 0 }}>
          {helperText}
        </p>
      )}

      {/* Autocomplete Dropdown */}
      {isDropdownOpen && (suggestions.length > 0 || (inputValue.trim() && allowCustom)) && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: '#1e293b',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
            maxHeight: '220px',
            overflowY: 'auto',
            padding: '0.25rem',
          }}
        >
          {suggestions.map((item, index) => {
            const isHighlighted = index === highlightedIndex;
            return (
              <div
                key={`${item.value}-${index}`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  addChip(item.value);
                  setIsDropdownOpen(false);
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: isHighlighted ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                  color: isHighlighted ? '#ffffff' : 'var(--text-primary)',
                  fontSize: '0.875rem',
                  transition: 'background 0.15s ease',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{item.label}</div>
                  {item.subtext && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{item.subtext}</div>
                  )}
                </div>
                {isHighlighted && <Check size={14} color="#818cf8" />}
              </div>
            );
          })}

          {inputValue.trim() && allowCustom && !suggestions.some((s) => s.value.toLowerCase() === inputValue.trim().toLowerCase()) && (
            <div
              onClick={() => {
                addChip(inputValue.trim());
                setIsDropdownOpen(false);
              }}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                borderTop: suggestions.length > 0 ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
                color: '#818cf8',
                fontSize: '0.8125rem',
                marginTop: '0.25rem',
              }}
            >
              Add "<strong>{inputValue.trim()}</strong>" (custom entry)
            </div>
          )}
        </div>
      )}
    </div>
  );
};
