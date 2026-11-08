import React from 'react';

/** One explicit selection; a default is a hint, never an instruction to pay. */
export default function WithdrawalDestinationPicker({ options, value, onChange, disabled = false }) {
  return <fieldset className="payout-destination-picker" disabled={disabled}>
    <legend>Withdraw to</legend>
    {options.map(option => <label className="payout-destination-choice" key={option.id}>
      <input type="radio" name="withdrawal-destination" value={option.id} checked={value === option.id}
        disabled={Boolean(option.unavailable)} onChange={() => onChange(option.id)} />
      <span><strong>{option.label}</strong><small>{option.unavailable || option.description}</small></span>
      {option.default ? <span className="payout-method-default">Default</span> : null}
    </label>)}
    {!options.some(o => !o.unavailable) ? <p>No eligible withdrawal destination. Add or complete a withdrawal method first.</p> : null}
  </fieldset>;
}
