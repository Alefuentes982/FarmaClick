#!/usr/bin/env bash
# Prepara una VM Ubuntu (Oracle Cloud) para recibir despliegues: instala Docker y crea ~/farmaclick.
# Uso (una sola vez por VM):  bash preparar-vm.sh
set -euo pipefail
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
# Ubuntu en OCI trae reglas iptables que bloquean 80/443 aunque la red de OCI las permita.
sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true
mkdir -p ~/farmaclick
[ -f ~/farmaclick/.env ] || echo "Falta crear ~/farmaclick/.env (copiar de deploy/.env.example y chmod 600)."
echo "Listo. Cierra la sesión SSH y vuelve a entrar para que el grupo docker tenga efecto."
