# Официальный образ Uptime Kuma 2.5.3 + наши модификации (force-check).
# Контекст сборки: ./uptime-kuma
# ВАЖНО: версия образа должна совпадать с версией, от которой сделаны правки (2.5.3).
FROM louislam/uptime-kuma:2.5.3

COPY --chown=node:node server/server.js /app/server/server.js
COPY --chown=node:node server/model/monitor.js /app/server/model/monitor.js
