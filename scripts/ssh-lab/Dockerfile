FROM alpine:3.21

RUN apk add --no-cache openssh-server socat \
  && adduser -D -s /bin/sh hermes \
  && passwd -d hermes \
  && mkdir -p /var/run/sshd /home/hermes/.ssh \
  && chmod 700 /home/hermes/.ssh \
  && ssh-keygen -A

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/entrypoint.sh"]
