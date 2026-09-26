import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useMe } from '../auth/session';
import { forgetClaims, pendingClaims } from './claims';
import { postClaims } from './fetch-logbook';
import { LOGBOOK_QUERY_KEY } from './logbook-keys';

/**
 * После входа — забрать в логбук полёты, загруженные в этом браузере без
 * входа (задача 2.11, ТЗ §7.1). Невидимый: живёт в корне приложения.
 */
export function ClaimOnSignIn() {
  const me = useMe();
  const client = useQueryClient();

  useEffect(() => {
    if (!me) return;
    const claims = pendingClaims();
    if (claims.length === 0) return;
    void postClaims(claims).then(
      () => {
        // Не забранные — чужие, уже с владельцем или удалены: помнить их незачем.
        forgetClaims(claims.map((c) => c.flightId));
        void client.invalidateQueries({ queryKey: LOGBOOK_QUERY_KEY });
      },
      // Сеть или сервер: токены остаются, попробуем при следующем открытии.
      () => undefined,
    );
  }, [me, client]);

  return null;
}
