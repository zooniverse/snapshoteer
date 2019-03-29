FROM node:11-slim
LABEL name "snapshoteer"

# See https://crbug.com/795759
# RUN apt-get update && apt-get install -yq libgconf-2-4

# Install latest chrome dev package and fonts to support major
# charsets (Chinese, Japanese, Arabic, Hebrew, Thai and a few others)
# Note: this installs the necessary libs to make the bundled version
# of Chromium that Puppeteer installs, work.
RUN apt-get update && apt-get install -y wget --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install --no-install-recommends -y google-chrome-unstable supervisor git \
       fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst ttf-freefont \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get purge --auto-remove -y curl \
    && rm -rf /src/*.deb

WORKDIR /node_app

COPY package.json /node_app/
RUN npm install .

COPY docker/supervisor.conf /etc/supervisor/conf.d/snapshoteer.conf

# We'll run the app as snapshoteer, non-privileged user via supervisor
# see docker/supervisor.conf
# Add user so we don't need --no-sandbox.
RUN groupadd -r snapshoteer && useradd -r -g snapshoteer -G audio,video snapshoteer \
    && mkdir -p /home/snapshoteer/Downloads \
    && chown -R snapshoteer:snapshoteer /node_app \
    && chown -R snapshoteer:snapshoteer /home/snapshoteer \
    && chown -R snapshoteer:snapshoteer ./node_modules


COPY . /node_app/

# log the commit id of this build for the healthcheck route
RUN cd /node_app && git log --format="%H" -n 1 > commit_id.txt

EXPOSE 8080
ENTRYPOINT /usr/bin/supervisord