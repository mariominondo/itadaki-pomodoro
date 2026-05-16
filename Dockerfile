FROM python:3.13-alpine3.20

WORKDIR /app

RUN adduser -D -u 1000 pomodoro

COPY --chown=pomodoro:pomodoro server.py index.html app.js style.css ./
COPY --chown=pomodoro:pomodoro assets ./assets

USER pomodoro

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/').status==200 else 1)" || exit 1

CMD ["python", "-u", "server.py"]
