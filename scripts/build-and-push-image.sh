#!/bin/bash
# build-and-push-image.sh
# Builda a imagem Docker e envia para o registry privado 10.10.2.30:5000

set -e

IMAGE_NAME="r-agent2-api"
REGISTRY="10.10.2.30:5000"
TAG="latest"

# Caminho do Dockerfile (ajuste se necessário)
DOCKERFILE_PATH="api/Dockerfile"
CONTEXT_PATH="api"

# Build da imagem

echo "==> Buildando imagem $IMAGE_NAME:$TAG..."
docker build -f "$DOCKERFILE_PATH" -t "$IMAGE_NAME:$TAG" "$CONTEXT_PATH"

echo "==> Tagueando para o registry..."
docker tag "$IMAGE_NAME:$TAG" "$REGISTRY/$IMAGE_NAME:$TAG"

echo "==> Enviando para o registry $REGISTRY..."
docker push "$REGISTRY/$IMAGE_NAME:$TAG"

echo "==> Imagem enviada com sucesso: $REGISTRY/$IMAGE_NAME:$TAG"