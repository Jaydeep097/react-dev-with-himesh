const button = document.getElementById("get-location-button");
const para = document.getElementById("status")

async function getData(lat,long){
    const promise = await fetch(
        `http://api.weatherapi.com/v1/current.json?key=8ced1c6438fa47d685c195903261902&q=${lat},${long}&aqi=yes`  
    );
    return await promise.json()
}


button.addEventListener('click',async()=>{
    para.textContent = "Geting your location..."

    navigator.geolocation.getCurrentPosition(
        async(position) =>{
            const lat = position.coords.latitude;
            const long = position.coords.longitude;

            para.textContent = `Latitude : ${lat}, longitude : ${long}`;

            const result = await getData(lat,long);
            console.log(result);
        },
        ()=>{
            para.textContent = "Failed to get location "
        }
    )
})