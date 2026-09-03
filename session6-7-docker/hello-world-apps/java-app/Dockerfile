# Stage 1: compile the java source
FROM eclipse-temurin:21-jdk AS builder

WORKDIR /app

COPY HelloWorld.java .

RUN javac HelloWorld.java

# Stage 2: run the compiled class on a smaller JRE image
FROM eclipse-temurin:21-jre

WORKDIR /app

COPY --from=builder /app/HelloWorld.class .

EXPOSE 8080

CMD ["java", "HelloWorld"]
