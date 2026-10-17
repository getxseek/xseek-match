import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  wrapperClassName?: string;
  buttonClassName?: string;
  showLabel?: string;
  hideLabel?: string;
  iconSize?: number;
};

export function PasswordInput({
  wrapperClassName = 'account-password',
  buttonClassName,
  showLabel = 'Show password',
  hideLabel = 'Hide password',
  iconSize = 18,
  ...inputProps
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={wrapperClassName}>
      <input {...inputProps} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className={buttonClassName}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        onClick={() => setVisible((prev) => !prev)}
      >
        {visible ? <EyeOff size={iconSize} /> : <Eye size={iconSize} />}
      </button>
    </div>
  );
}
