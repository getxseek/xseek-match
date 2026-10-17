import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { PasswordInput } from '../../../components/ui/password-input';
import { SettingsSection } from '../../../components/ui/settings-section';
import { authFetch } from '../../auth/auth-client';

export function AccountPanel() {
  const [currentPassword, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const response = await authFetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error();
      location.reload();
    } catch {
      setMessage('Could not sign out. Please retry.');
      setBusy(false);
    }
  }

  async function change(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await authFetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      location.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not change password');
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      title="Account"
      help="Changing your password signs out every device. Sign out ends only this browser’s session. Lost passwords can be reset with the Docker CLI command in the README."
    >
      <form className="account-form" onSubmit={change}>
        <label>
          Current password
          <PasswordInput
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            showLabel="Show current password"
            hideLabel="Hide current password"
          />
        </label>
        <label>
          New password
          <PasswordInput
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            showLabel="Show new password"
            hideLabel="Hide new password"
          />
        </label>
        <p className="match-note">
          At least 8 characters. Changing your password signs out all sessions.
        </p>
        <div className="account-actions">
          <Button disabled={busy}>Change password</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
        <p role="status" className="match-note">
          {message}
        </p>
      </form>
    </SettingsSection>
  );
}
