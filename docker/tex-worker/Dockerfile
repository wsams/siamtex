# SiamTeX compile worker
# Engines: pdflatex, xelatex, lualatex, bibtex, biber, latexmk
# latest-small already includes most template deps; we add titlesec (resume).
FROM texlive/texlive:latest-small

USER root

# Only install packages not already in latest-small.
# (amssymb/graphicx are not separate tlmgr package names — they ship with amsfonts/graphics.)
# booktabs: lab-report template and catalog table snippets.
RUN tlmgr update --self \
  && tlmgr install titlesec booktabs \
  && tlmgr path add \
  && rm -rf /tmp/texlive* /var/tmp/*

RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin texuser \
  && mkdir -p /work \
  && chown texuser:texuser /work

WORKDIR /work
USER texuser

ENTRYPOINT ["latexmk"]
CMD ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "main.tex"]
