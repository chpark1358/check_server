type AuthSource<T> = {
  getSession: () => Promise<{ data: { session: T | null }; error: { message: string } | null }>;
  onAuthStateChange: (callback: (event: string, session: T | null) => void) => {
    data: { subscription: { unsubscribe: () => void } };
  };
};

/** Subscribe before restoring; an old snapshot must not overwrite a login/logout event. */
export function observePersistedSession<T>(
  auth: AuthSource<T>,
  onSession: (session: T | null) => void,
  onError: (message: string) => void,
) {
  let active = true;
  let authRevision = 0;
  const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
    authRevision += 1;
    if (active) onSession(session);
  });
  const snapshotRevision = authRevision;
  void auth.getSession().then(({ data, error }) => {
    if (!active || snapshotRevision !== authRevision) return;
    if (error) onError(error.message);
    else onSession(data.session);
  }).catch((error: unknown) => {
    if (active && snapshotRevision === authRevision) {
      onError(error instanceof Error ? error.message : "저장된 로그인 정보를 확인할 수 없습니다.");
    }
  });
  return () => { active = false; subscription.unsubscribe(); };
}
