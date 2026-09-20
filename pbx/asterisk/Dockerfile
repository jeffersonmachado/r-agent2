FROM debian:bookworm-slim AS odbc_builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    unixodbc \
    odbc-postgresql \
  && rm -rf /var/lib/apt/lists/*

# Collect driver libs (paths vary a bit across distros; Debian bookworm uses this)
RUN mkdir -p /out/odbc && \
    cp -a /usr/lib/x86_64-linux-gnu/odbc/psqlodbcw.so /out/odbc/psqlodbcw.so && \
    (test -f /usr/lib/x86_64-linux-gnu/odbc/libodbcpsqlS.so && cp -a /usr/lib/x86_64-linux-gnu/odbc/libodbcpsqlS.so /out/odbc/libodbcpsqlS.so || true) && \
    (test -f /usr/lib/x86_64-linux-gnu/odbc/psqlodbc.so && cp -a /usr/lib/x86_64-linux-gnu/odbc/psqlodbc.so /out/odbc/psqlodbc.so || true) && \
    (test -f /usr/lib/x86_64-linux-gnu/odbc/psqlodbca.so && cp -a /usr/lib/x86_64-linux-gnu/odbc/psqlodbca.so /out/odbc/psqlodbca.so || true)

FROM andrius/asterisk:18

# Ensure target dir exists in base image
USER root
RUN mkdir -p /usr/lib/x86_64-linux-gnu/odbc

COPY --from=odbc_builder /out/odbc/ /usr/lib/x86_64-linux-gnu/odbc/

# Start que renderiza o manager.conf do template (segredo + ACL no mesmo bloco)
# no /etc/asterisk gravável (tmpfs do compose) antes de subir o Asterisk.
COPY asterisk-start.sh /usr/local/bin/asterisk-start
RUN chmod 755 /usr/local/bin/asterisk-start

USER asterisk

